from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import db, materials, models_api
from .site_api import cors_origins, router as site_router

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    materials.import_if_empty()
    models_api.fail_interrupted_jobs()
    yield
    db.pool.close()


app = FastAPI(title="Structural App API", lifespan=lifespan)
app.include_router(site_router)
app.include_router(materials.router)
app.include_router(models_api.router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/folders")
def list_folders():
    """Flat folder list; `file_count` is recursive (includes subfolders)."""
    with db.pool.connection() as conn:
        rows = conn.execute(
            """
            WITH RECURSIVE sub AS (
                SELECT id AS root_id, id FROM folders
                UNION ALL
                SELECT sub.root_id, f.id FROM folders f JOIN sub ON f.parent_id = sub.id
            )
            SELECT f.id, f.parent_id, f.name, f.position,
                   (SELECT count(*) FROM documents d
                     JOIN sub ON d.folder_id = sub.id
                    WHERE sub.root_id = f.id)::int AS file_count
              FROM folders f
             ORDER BY f.parent_id NULLS FIRST, f.position, f.name
            """
        ).fetchall()
    return rows


@app.get("/api/documents")
def list_documents(folder_id: int, recursive: bool = False):
    with db.pool.connection() as conn:
        if recursive:
            sql = """
                WITH RECURSIVE sub AS (
                    SELECT id FROM folders WHERE id = %s
                    UNION ALL
                    SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
                )
                SELECT d.id, d.folder_id, d.filename, d.content_type, d.size_bytes, d.uploaded_at
                  FROM documents d JOIN sub ON d.folder_id = sub.id
                 ORDER BY d.filename
            """
        else:
            sql = """
                SELECT id, folder_id, filename, content_type, size_bytes, uploaded_at
                  FROM documents WHERE folder_id = %s ORDER BY filename
            """
        return conn.execute(sql, (folder_id,)).fetchall()


def _store_uploads(folder_id: int, files: list[UploadFile], data_list: list[bytes]) -> list[dict]:
    created = []
    with db.pool.connection() as conn:
        if conn.execute("SELECT 1 FROM folders WHERE id = %s", (folder_id,)).fetchone() is None:
            raise HTTPException(404, "Folder not found")
        for upload, data in zip(files, data_list, strict=True):
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, f"{upload.filename} exceeds 200 MB")
            created.append(
                conn.execute(
                    """
                    INSERT INTO documents (folder_id, filename, content_type, size_bytes, data)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, folder_id, filename, content_type, size_bytes, uploaded_at
                    """,
                    (
                        folder_id,
                        upload.filename or "untitled",
                        upload.content_type or "application/octet-stream",
                        len(data),
                        data,
                    ),
                ).fetchone()
            )
    return created


@app.post("/api/documents", status_code=201)
async def upload_documents(folder_id: int = Form(...), files: list[UploadFile] = File(...)):
    payloads = [await upload.read() for upload in files]
    return _store_uploads(folder_id, files, payloads)


@app.post("/api/site-reports/archive", status_code=201)
async def archive_site_report(files: list[UploadFile] = File(...)):
    """Store the CSV and PDF issued with a SkyCiv site report.

    Files land in Documents › Project Documents › Site Reports so they
    appear in the default Documents listing.
    """
    if not files:
        raise HTTPException(400, "Attach the site-report CSV and PDF.")
    payloads = [await upload.read() for upload in files]
    folder_id = db.ensure_folder_path()
    documents = _store_uploads(folder_id, files, payloads)
    return {
        "folder_id": folder_id,
        "folder_path": list(db.SITE_REPORTS_PATH),
        "documents": documents,
    }


@app.get("/api/documents/{doc_id}/download")
def download_document(doc_id: int):
    with db.pool.connection() as conn:
        row = conn.execute(
            "SELECT filename, content_type, data, storage_path FROM documents WHERE id = %s", (doc_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Document not found")
    if row["storage_path"]:  # large upload kept on disk (IFC models)
        if not Path(row["storage_path"]).is_file():
            raise HTTPException(410, "The stored file is no longer on disk")
        return FileResponse(row["storage_path"], media_type=row["content_type"], filename=row["filename"])
    return Response(
        content=bytes(row["data"]),
        media_type=row["content_type"],
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row['filename'])}"
        },
    )


@app.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int):
    with db.pool.connection() as conn:
        deleted = conn.execute("DELETE FROM documents WHERE id = %s", (doc_id,)).rowcount
    if not deleted:
        raise HTTPException(404, "Document not found")
    return Response(status_code=204)
