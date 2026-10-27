# Structural App

React (Vite + TypeScript) frontend, Python (FastAPI) backend, PostgreSQL storage.

Menus: **Analytics, Documents, Settings, Lateral, Gravity, Reports**.
Only **Documents** is functional (upload / download / delete); the other five are placeholders
waiting for data.

## Run

```bash
docker compose up -d                       # Postgres 16 on localhost:55432
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8100 --reload --reload-dir app
cd frontend && npm install && npm run dev  # http://localhost:5180
```

The API creates its tables (`backend/schema.sql`) and a default folder tree on first start.

## Documents

- Folder tree (left) with recursive file counts, checkboxes, expand/collapse and breadcrumb.
- File list (right) shows files in the selected folder and its subfolders.
- Upload: **Upload** button or drag-and-drop onto the file list; files go into the selected folder.
- Download: per-row icon, or check files/folders and use **Download**.
- Delete: per-row icon, or check files/folders and use **Delete** (a confirmation dialog always appears).
  Checking a folder selects every file under it.
- Files are stored in Postgres (`documents.data BYTEA`), max 200 MB each.
- Folders are seeded (`SEED_TREE` in `backend/app/db.py`); there is no create/rename folder UI.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/folders` | flat folder list with recursive `file_count` |
| GET | `/api/documents?folder_id=&recursive=` | files in a folder |
| POST | `/api/documents` | multipart `folder_id` + `files[]` |
| GET | `/api/documents/{id}/download` | file bytes as attachment |
| DELETE | `/api/documents/{id}` | remove a file |

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q   # needs the docker DB running
```
