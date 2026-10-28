"""Where IFC files live: Supabase Storage when configured, else the local disk.

With SUPABASE_URL and SUPABASE_SERVICE_KEY set, uploads go to a private bucket and the
host keeps no files (Render's disk is wiped on every deploy). `storage_path` columns then
hold ``supabase:<object key>``; a plain filesystem path still means a local file, so
local development and the test suite work without Supabase.

The service key is a server-side secret. It never reaches the browser: downloads are
streamed through the API.
"""
from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

import httpx

REMOTE_PREFIX = "supabase:"
CHUNK = 8 * 1024 * 1024
TIMEOUT = httpx.Timeout(600.0, connect=15.0)


def _url() -> str:
    return os.environ.get("SUPABASE_URL", "").strip().rstrip("/")


def _key() -> str:
    return os.environ.get("SUPABASE_SERVICE_KEY", "").strip()


def bucket() -> str:
    return os.environ.get("SUPABASE_BUCKET", "ifc-models").strip() or "ifc-models"


def enabled() -> bool:
    return bool(_url() and _key())


def is_remote(storage_path: str | None) -> bool:
    return bool(storage_path) and storage_path.startswith(REMOTE_PREFIX)


def _key_of(ref: str) -> str:
    return ref[len(REMOTE_PREFIX):]


def _headers(**extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {_key()}", "apikey": _key(), **extra}


def _object_url(object_key: str) -> str:
    return f"{_url()}/storage/v1/object/{quote(bucket())}/{quote(object_key, safe='/')}"


def ensure_bucket() -> None:
    """Create the private bucket if it is missing. Failures are logged, not fatal."""
    if not enabled():
        return
    try:
        r = httpx.post(
            f"{_url()}/storage/v1/bucket",
            headers=_headers(**{"Content-Type": "application/json"}),
            json={"id": bucket(), "name": bucket(), "public": False},
            timeout=TIMEOUT,
        )
        if r.status_code >= 400 and "already exists" not in r.text.lower() and r.status_code != 409:
            print(f"storage: could not create bucket {bucket()!r}: {r.status_code} {r.text[:200]}", flush=True)
    except httpx.HTTPError as e:
        print(f"storage: could not reach Supabase to create the bucket: {e}", flush=True)


def _chunks(path: Path) -> Iterator[bytes]:
    with path.open("rb") as fh:
        while block := fh.read(CHUNK):
            yield block


def upload(object_key: str, path: Path, content_type: str = "application/octet-stream") -> str:
    """Send a local file to the bucket and return its ``supabase:`` reference."""
    r = httpx.post(
        _object_url(object_key),
        headers=_headers(**{
            "Content-Type": content_type,
            "Content-Length": str(path.stat().st_size),
            "x-upsert": "true",
        }),
        content=_chunks(path),
        timeout=TIMEOUT,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase Storage upload failed ({r.status_code}): {r.text[:200]}")
    return REMOTE_PREFIX + object_key


@contextmanager
def open_stream(ref: str) -> Iterator[httpx.Response]:
    """The object's bytes as an open streaming response (raises if it is missing)."""
    with httpx.stream("GET", _object_url(_key_of(ref)), headers=_headers(), timeout=TIMEOUT) as r:
        r.raise_for_status()
        yield r


def download_to(ref: str, dest: Path) -> None:
    with open_stream(ref) as r, dest.open("wb") as out:
        for block in r.iter_bytes(CHUNK):
            out.write(block)


def delete(ref: str) -> None:
    """Remove the object; a failure is logged and ignored (the DB row is what matters)."""
    try:
        httpx.delete(_object_url(_key_of(ref)), headers=_headers(), timeout=TIMEOUT)
    except httpx.HTTPError as e:
        print(f"storage: could not delete {ref}: {e}", flush=True)


@contextmanager
def local_copy(storage_path: str) -> Iterator[Path]:
    """A readable local file for ``storage_path``: itself, or a temp download that is removed after."""
    if not is_remote(storage_path):
        yield Path(storage_path)
        return
    suffix = Path(_key_of(storage_path)).suffix or ".ifc"
    with tempfile.TemporaryDirectory(prefix="ifc-") as tmp:
        dest = Path(tmp) / f"model{suffix}"
        download_to(storage_path, dest)
        yield dest
