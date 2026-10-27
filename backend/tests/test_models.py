"""IFC upload -> background extraction -> stored result + decisions, against the docker Postgres.

Uses a synthetic IFC (tests/make_ifc.py), not a client model.
"""
import time

import pytest
from fastapi.testclient import TestClient

from app import db, models_api
from app.main import app
from tests.make_ifc import build


def _wait_ready(client, model_id, timeout=120):
    seen = set()
    end = time.time() + timeout
    while time.time() < end:
        m = client.get(f"/api/models/{model_id}").json()
        seen.add(m["status"])
        if m["status"] in ("ready", "failed"):
            return m, seen
        time.sleep(0.3)
    raise AssertionError(f"model {model_id} still {m['status']} after {timeout}s")


def _seed_brick_row():
    """The 4in clay brick wythe the test expects as R77.

    Kim's spreadsheet lives outside git, so a fresh database (CI, a new Postgres) has no
    materials rows. Insert R77 only when it is missing, so a real import is never overwritten.
    Returns True when this call inserted it.
    """
    with db.pool.connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO materials (id, t_in, material, orientation, use, info, psf, source, custom, edited, position)
            VALUES ('R77', 4, 'clay brick', '', 'wall', '4 in wythe', 40, 'test fixture', false, false, 0)
            ON CONFLICT (id) DO NOTHING
            """
        )
        return cur.rowcount == 1


def _drop_seeded_brick_row():
    with db.pool.connection() as conn:
        conn.execute("DELETE FROM materials WHERE id = 'R77' AND source = 'test fixture'")


@pytest.fixture
def brick_row():
    """Seed R77, and remove it afterwards only if this test added it.

    Each TestClient block opens (and closes) the app's pool, so seeding and cleanup get their own.
    """
    with TestClient(app):
        seeded = _seed_brick_row()
    yield
    if seeded:
        with TestClient(app):
            _drop_seeded_brick_row()


def test_upload_extract_and_decisions(tmp_path, monkeypatch, brick_row):
    monkeypatch.setattr(models_api, "MODELS_DIR", tmp_path)
    ifc = build(str(tmp_path / "synthetic.ifc"))
    with TestClient(app) as client:
        with open(ifc, "rb") as fh:
            r = client.post("/api/models", files=[("file", ("Synthetic Tower.ifc", fh, "application/octet-stream"))])
        assert r.status_code == 201, r.text
        model = r.json()
        assert model["status"] == "queued"

        done, _ = _wait_ready(client, model["id"])
        assert done["status"] == "ready", done["error"]
        assert done["progress"] == 1

        data = client.get(f"/api/models/{model['id']}/data").json()
        result = data["result"]
        assert [lv["name"] for lv in result["levels"]] == ["Level 1", "Level 2"]
        kinds = {t["kind"]: t for t in result["types"]}
        assert set(kinds) == {"wall", "floor"}
        brick = kinds["wall"]["layers"][0]["match"]
        assert (brick["status"], brick["row_id"]) == ("matched", "R77")  # read from the materials table
        assert abs(kinds["wall"]["qty"]["length_lf"] - 419.9) < 1
        assert result["plan"], "plan geometry missing"

        # the upload is listed in Documents > 3D Models and downloads from disk
        docs = client.get("/api/documents", params={"folder_id": _folder_id(client, "3D Models")}).json()
        assert any(d["id"] == model["document_id"] for d in docs)
        dl = client.get(f"/api/documents/{model['document_id']}/download")
        assert dl.status_code == 200 and dl.content == open(ifc, "rb").read()

        tid = kinds["wall"]["id"]
        decision = {"include": False, "assemblyName": "Brick on Stud", "status": "done"}
        assert client.put(f"/api/models/{model['id']}/types/{tid}", json=decision).status_code == 204
        assert client.patch(f"/api/models/{model['id']}/settings", json={"project_name": "Tower"}).json()["project_name"] == "Tower"

    # a new app instance (= reload) sees the same decisions
    with TestClient(app) as client:
        data = client.get(f"/api/models/{model['id']}/data").json()
        assert data["decisions"][tid] == decision
        assert data["settings"]["project_name"] == "Tower"
        client.delete(f"/api/documents/{model['document_id']}")


def test_rejects_non_ifc(tmp_path, monkeypatch):
    monkeypatch.setattr(models_api, "MODELS_DIR", tmp_path)
    with TestClient(app) as client:
        r = client.post("/api/models", files=[("file", ("tower.rvt", b"x", "application/octet-stream"))])
        assert r.status_code == 400
        assert "IFC" in r.json()["detail"]


def test_bad_ifc_reports_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(models_api, "MODELS_DIR", tmp_path)
    with TestClient(app) as client:
        r = client.post("/api/models", files=[("file", ("broken.ifc", b"not an ifc", "application/octet-stream"))])
        done, _ = _wait_ready(client, r.json()["id"])
        assert done["status"] == "failed"
        assert done["error"]
        client.delete(f"/api/documents/{r.json()['document_id']}")


def _folder_id(client, name):
    return next(f["id"] for f in client.get("/api/folders").json() if f["name"] == name)
