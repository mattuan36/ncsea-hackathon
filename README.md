# LightenTheLoad (working name)

React (Vite + TypeScript) frontend, Python (FastAPI) backend, PostgreSQL storage.

Menus: **Analytics, Documents, Settings, Lateral, Gravity, Reports**.

| Menu | State |
|---|---|
| Documents | Working: upload / download / delete, stored in Postgres |
| Gravity | **Wireframe** — dead-load takeoff wizard (6 steps, below) |
| Reports | **Wireframe** — graphical output sheets + spreadsheet layout preview |
| Settings | **Wireframe** — project info + material database |
| Analytics | **Wireframe** — takeoff summary (KPIs, dead load by assembly) |
| Lateral | Placeholder (no requirements yet) |

### Wireframe scope (Gravity / Reports / Settings / Analytics)

- Frontend only, sample data (`frontend/src/ltl/data.ts`): reading the Revit/IFC model is
  **simulated**; any chosen source shows the same sample floor/wall types and plan geometry.
- State is in memory (`frontend/src/ltl/store.tsx`) and **resets on page reload**.
- Real calculations: PSF = pcf × t / 12 (or listed psf per thickness), overrides win; plan areas
  (shoelace) and wall lengths are computed from the geometry; kips = psf × SF, walls psf × height × LF.
- Material unit weights are typical values — verify against ASCE 7 Table C3.1-1 before design use.
- Not built yet: real IFC/Revit parsing, persistence of takeoffs, `.xlsx` export (button disabled).

Gravity steps: 1 Model (upload IFC via Documents › 3D Models, or point to a Revit path) →
2 Floor types / 3 Wall types (filter unused by instance count) → 4 Type table →
5 Build assemblies (walk each type grouped by Revit structural material: labeled section graphic,
searchable material + thickness dropdowns, PSF override, add material to DB, verify material,
most-similar suggestion, skip, copy layers, merge as sub-assembly with governing choice) →
6 Plan view (Bluebeam-style markups, thick wall lines, SF/LF, legend with expandable breakdown,
click legend/area/wall to isolate).

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
