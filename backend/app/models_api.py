"""Uploaded IFC models: store on disk, extract in a background process, keep the user's decisions.

An upload is written to MODELS_DIR (outside git), listed in Documents › 3D
Models, and handed to `python -m app.extract_job <id>`, which runs gravity_ifc
and reports its stage and progress into the `models` row. The browser polls
GET /api/models/{id} until the status is ready or failed.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from . import db
from .materials import INPUTS_DIR

MODELS_DIR = Path(os.environ.get("LTL_MODELS_DIR", INPUTS_DIR / "models"))
MAX_MODEL_BYTES = 2 * 1024**3
BACKEND_DIR = Path(__file__).resolve().parents[1]
MODELS_FOLDER_PATH = ("My Project", "Project Documents", "3D Models")

STATUS_COLUMNS = "id, filename, document_id, size_bytes, status, stage, progress, error, settings, created_at, finished_at"

router = APIRouter(prefix="/api/models")


def fail_interrupted_jobs() -> None:
    """A job still 'running' when the API starts lost its worker with the old process."""
    with db.pool.connection() as conn:
        conn.execute(
            """
            UPDATE models SET status = 'failed', error = 'Interrupted: the API restarted while this model was being read. Re-run it.',
                   finished_at = now()
             WHERE status IN ('queued', 'running')
            """
        )


def _start_job(model_id: int) -> None:
    log = open(MODELS_DIR / f"{model_id}.log", "w")
    subprocess.Popen(
        [sys.executable, "-m", "app.extract_job", str(model_id)],
        cwd=BACKEND_DIR, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        env={**os.environ, "DATABASE_URL": db.DATABASE_URL},
    )


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.\- ]+", "_", Path(name).name).strip() or "model.ifc"


def _create(filename: str, size: int, storage_path: Path, document_id: int | None) -> dict:
    with db.pool.connection() as conn:
        return conn.execute(
            f"""
            INSERT INTO models (filename, document_id, storage_path, size_bytes)
            VALUES (%s, %s, %s, %s) RETURNING {STATUS_COLUMNS}
            """,
            (filename, document_id, str(storage_path), size),
        ).fetchone()


def _check_ifc(filename: str) -> None:
    if not filename.lower().endswith((".ifc", ".ifczip")):
        raise HTTPException(400, "Export the Revit model to IFC (.ifc) first; .rvt files cannot be read.")


@router.post("", status_code=201)
def upload_model(file: UploadFile = File(...)):
    """Store an IFC on disk, list it in Documents › 3D Models, and start extraction."""
    filename = _safe_name(file.filename or "model.ifc")
    _check_ifc(filename)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = MODELS_DIR / f".upload-{os.getpid()}-{id(file)}"
    with tmp.open("wb") as out:
        shutil.copyfileobj(file.file, out, length=8 * 1024 * 1024)
    size = tmp.stat().st_size
    if size > MAX_MODEL_BYTES:
        tmp.unlink()
        raise HTTPException(413, f"{filename} exceeds 2 GB")
    folder_id = db.ensure_folder_path(MODELS_FOLDER_PATH)
    with db.pool.connection() as conn:
        doc = conn.execute(
            """
            INSERT INTO documents (folder_id, filename, content_type, size_bytes, data, storage_path)
            VALUES (%s, %s, 'application/x-step', %s, NULL, '') RETURNING id
            """,
            (folder_id, filename, size),
        ).fetchone()
        path = MODELS_DIR / f"{doc['id']}-{filename}"
        tmp.rename(path)
        conn.execute("UPDATE documents SET storage_path = %s WHERE id = %s", (str(path), doc["id"]))
    model = _create(filename, size, path, doc["id"])
    _start_job(model["id"])
    return model


@router.post("/from-document/{doc_id}", status_code=201)
def model_from_document(doc_id: int):
    """Extract an IFC already in Documents (uploaded before models existed, or re-run)."""
    with db.pool.connection() as conn:
        doc = conn.execute(
            "SELECT id, filename, size_bytes, storage_path, data FROM documents WHERE id = %s", (doc_id,)
        ).fetchone()
    if doc is None:
        raise HTTPException(404, "Document not found")
    _check_ifc(doc["filename"])
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if doc["storage_path"]:
        path = Path(doc["storage_path"])
        if not path.is_file():
            raise HTTPException(410, "The stored file is no longer on disk")
    else:
        path = MODELS_DIR / f"{doc['id']}-{_safe_name(doc['filename'])}"
        path.write_bytes(bytes(doc["data"]))
    model = _create(doc["filename"], doc["size_bytes"], path, doc["id"])
    _start_job(model["id"])
    return model


@router.get("")
def list_models():
    with db.pool.connection() as conn:
        return conn.execute(f"SELECT {STATUS_COLUMNS} FROM models ORDER BY created_at DESC").fetchall()


@router.get("/{model_id}")
def get_model(model_id: int):
    with db.pool.connection() as conn:
        row = conn.execute(f"SELECT {STATUS_COLUMNS} FROM models WHERE id = %s", (model_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Model not found")
    return row


@router.get("/{model_id}/data")
def get_model_data(model_id: int):
    """The extraction plus the user's saved decisions, keyed by type id."""
    with db.pool.connection() as conn:
        row = conn.execute(f"SELECT {STATUS_COLUMNS}, result FROM models WHERE id = %s", (model_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Model not found")
        if row["status"] != "ready":
            raise HTTPException(409, f"Model is {row['status']}")
        decisions = conn.execute(
            "SELECT type_id, decision FROM model_type_decisions WHERE model_id = %s", (model_id,)
        ).fetchall()
    return {**row, "decisions": {d["type_id"]: d["decision"] for d in decisions}}


@router.put("/{model_id}/types/{type_id}", status_code=204)
def save_decision(model_id: int, type_id: str, decision: dict):
    with db.pool.connection() as conn:
        if conn.execute("SELECT 1 FROM models WHERE id = %s", (model_id,)).fetchone() is None:
            raise HTTPException(404, "Model not found")
        conn.execute(
            """
            INSERT INTO model_type_decisions (model_id, type_id, decision) VALUES (%s, %s, %s)
            ON CONFLICT (model_id, type_id) DO UPDATE SET decision = EXCLUDED.decision, updated_at = now()
            """,
            (model_id, type_id, Jsonb(decision)),
        )
    return Response(status_code=204)


class SettingsPatch(BaseModel):
    project_name: str | None = None
    allowance_options: list[str] | None = None


@router.patch("/{model_id}/settings")
def patch_settings(model_id: int, patch: SettingsPatch):
    with db.pool.connection() as conn:
        row = conn.execute(
            "UPDATE models SET settings = settings || %s WHERE id = %s RETURNING settings",
            (Jsonb(patch.model_dump(exclude_unset=True)), model_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Model not found")
    return row["settings"]
