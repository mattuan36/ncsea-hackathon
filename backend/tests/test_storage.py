"""IFC files in Supabase Storage (against a fake storage server) and the spreadsheet upload.

The fake speaks the four Storage REST calls the API uses, so the whole path runs for real:
upload -> row points at `supabase:` -> extraction downloads it -> download proxies it back.
"""
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from app import models_api, storage
from app.main import app
from tests.make_ifc import build
from tests.test_materials import _sheet

KEY = "test-service-key"


class _FakeStorage(ThreadingHTTPServer):
    def __init__(self):
        super().__init__(("127.0.0.1", 0), _Handler)
        self.objects: dict[str, bytes] = {}
        self.buckets: list[str] = []
        self.bad_auth = 0


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep pytest output quiet
        pass

    def _authed(self) -> bool:
        if self.headers.get("Authorization") != f"Bearer {KEY}" or self.headers.get("apikey") != KEY:
            self.server.bad_auth += 1
            self._reply(401, b'{"message":"bad key"}')
            return False
        return True

    def _reply(self, code: int, body: bytes = b"", ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _object_key(self) -> str | None:
        prefix = "/storage/v1/object/"
        return unquote(self.path[len(prefix):]) if self.path.startswith(prefix) else None

    def do_POST(self):
        if not self._authed():
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/storage/v1/bucket":
            self.server.buckets.append(body.decode())
            return self._reply(200, b'{"name":"ok"}')
        key = self._object_key()
        if key is None:
            return self._reply(404)
        self.server.objects[key] = body
        self._reply(200, b'{"Key":"ok"}')

    def do_GET(self):
        if not self._authed():
            return
        data = self.server.objects.get(self._object_key() or "")
        if data is None:
            return self._reply(404, b'{"message":"Object not found"}')
        self._reply(200, data, "application/octet-stream")

    def do_DELETE(self):
        if not self._authed():
            return
        self.server.objects.pop(self._object_key() or "", None)
        self._reply(200, b'{"message":"deleted"}')


@pytest.fixture
def fake_supabase(monkeypatch):
    server = _FakeStorage()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("SUPABASE_URL", f"http://127.0.0.1:{server.server_address[1]}")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", KEY)
    monkeypatch.setenv("SUPABASE_BUCKET", "ifc-models")
    yield server
    server.shutdown()


def _wait_ready(client, model_id, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        m = client.get(f"/api/models/{model_id}").json()
        if m["status"] in ("ready", "failed"):
            return m
        time.sleep(0.3)
    raise AssertionError(f"model {model_id} still {m['status']} after {timeout}s")


def test_model_lives_in_supabase_and_the_host_keeps_nothing(tmp_path, monkeypatch, fake_supabase):
    scratch = tmp_path / "scratch"
    monkeypatch.setattr(models_api, "MODELS_DIR", scratch)
    ifc = build(str(tmp_path / "synthetic.ifc"))
    original = open(ifc, "rb").read()
    assert storage.enabled()

    with TestClient(app) as client:
        assert fake_supabase.buckets, "the private bucket is created on start"
        with open(ifc, "rb") as fh:
            r = client.post("/api/models", files=[("file", ("Revit Export.ifc", fh, "application/octet-stream"))])
        assert r.status_code == 201, r.text
        model = r.json()

        done = _wait_ready(client, model["id"])
        assert done["status"] == "ready", done["error"]  # extraction downloaded it from storage

        assert model["document_id"] is not None
        (key,) = fake_supabase.objects
        assert key.startswith("ifc-models/models/") and key.endswith("-Revit Export.ifc")
        assert fake_supabase.objects[key] == original
        assert fake_supabase.bad_auth == 0

        # the host holds no model file; only the extraction log may be in scratch
        assert [p.name for p in scratch.iterdir() if p.suffix != ".log"] == []

        dl = client.get(f"/api/documents/{model['document_id']}/download")
        assert dl.status_code == 200 and dl.content == original
        assert "Revit%20Export.ifc" in dl.headers["content-disposition"]

        # deleting the document keeps the object while the model still reads it
        assert client.delete(f"/api/documents/{model['document_id']}").status_code == 204
        assert key in fake_supabase.objects
        client.delete(f"/api/models/{model['id']}")


def test_upload_fails_cleanly_when_storage_rejects_it(tmp_path, monkeypatch, fake_supabase):
    monkeypatch.setattr(models_api, "MODELS_DIR", tmp_path / "scratch")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "wrong-key")
    ifc = build(str(tmp_path / "synthetic.ifc"))
    with TestClient(app) as client:
        with open(ifc, "rb") as fh:
            r = client.post("/api/models", files=[("file", ("m.ifc", fh, "application/octet-stream"))])
        assert r.status_code == 502
        assert "Supabase Storage upload failed" in r.json()["detail"]
        assert not fake_supabase.objects
        assert [p for p in (tmp_path / "scratch").iterdir()] == [], "no half-written upload left behind"


def test_without_supabase_files_stay_on_local_disk(tmp_path, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    monkeypatch.setattr(models_api, "MODELS_DIR", tmp_path / "scratch")
    ifc = build(str(tmp_path / "synthetic.ifc"))
    assert not storage.enabled()
    with TestClient(app) as client:
        with open(ifc, "rb") as fh:
            r = client.post("/api/models", files=[("file", ("local.ifc", fh, "application/octet-stream"))])
        assert r.status_code == 201, r.text
        docs = client.get("/api/documents", params={"folder_id": 1, "recursive": True}).json()
        assert any(d["id"] == r.json()["document_id"] for d in docs)
        assert (tmp_path / "scratch" / f"{r.json()['document_id']}-local.ifc").is_file()
        _wait_ready(client, r.json()["id"])
        client.delete(f"/api/documents/{r.json()['document_id']}")


def test_spreadsheet_upload_imports_materials(tmp_path):
    sheet = _sheet(tmp_path / "Dead_Load.xlsx", with_orientation=True)
    with TestClient(app) as client:
        with open(sheet, "rb") as fh:
            ok = client.post("/api/materials/import-file", files=[("file", ("Dead_Load.xlsx", fh, "application/octet-stream"))])
        assert ok.status_code == 200, ok.text
        assert ok.json()["rows"] >= 2
        assert any(m["material"] == "cmu" for m in client.get("/api/materials").json())

        bad = client.post("/api/materials/import-file", files=[("file", ("notes.txt", b"x", "text/plain"))])
        assert bad.status_code == 400
        broken = client.post("/api/materials/import-file", files=[("file", ("x.xlsx", b"not a workbook", "application/octet-stream"))])
        assert broken.status_code == 400
