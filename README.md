# LightenTheLoad web app

React (Vite + TypeScript) frontend, Python (FastAPI) backend, PostgreSQL storage.

The published site is [https://mattuan36.github.io/ncsea-hackathon/](https://mattuan36.github.io/ncsea-hackathon/). A push to `main` builds `frontend/` and deploys it with GitHub Pages. Lateral calls the site API (`VITE_API_BASE`, or the local proxy). Documents still needs the local API. The SkyCiv key is only on the API server.

Menus: **Analytics, Documents, Settings, Lateral, Gravity, Reports**.

| Menu | State |
|---|---|
| Documents | Working: upload / download / delete, stored in Postgres |
| Gravity | **Wireframe** — dead-load takeoff wizard (6 steps, below) |
| Reports | **Wireframe** — graphical output sheets + spreadsheet layout preview |
| Settings | **Wireframe** — project info + material database |
| Analytics | **Wireframe** — takeoff summary (KPIs, dead load by assembly) |
| Lateral | Site wind, snow, and seismic report. Search or drop a pin in the United States, Alaska, or Puerto Rico. The page calls the site API, which holds `SKYCIV_USERNAME` and `SKYCIV_KEY`. The key is not in the browser or the repo. |

#### Wireframe scope (Gravity / Reports / Settings / Analytics)

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

### Run

```bash
# all paths relative to the repo root
docker compose up -d                       # Postgres 16 on localhost:55432
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8100 --reload --reload-dir app
cd frontend && npm install && npm run dev  # http://localhost:5180
```

The API creates its tables (`backend/schema.sql`) and a default folder tree on first start.

The Lateral page calls `POST /api/site-report` on port 8101. That process does not use Postgres. It reads `SKYCIV_USERNAME` and `SKYCIV_KEY` from the environment, `.env`, or `API_Key.txt`.

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-site.txt
.venv/bin/uvicorn app.site_api:app --port 8101
```

### Documents

- Folder tree (left) with recursive file counts, checkboxes, expand/collapse and breadcrumb.
- File list (right) shows files in the selected folder and its subfolders.
- Upload: **Upload** button or drag-and-drop onto the file list; files go into the selected folder.
- Download: per-row icon, or check files/folders and use **Download**.
- Delete: per-row icon, or check files/folders and use **Delete** (a confirmation dialog always appears).
  Checking a folder selects every file under it.
- Files are stored in Postgres (`documents.data BYTEA`), max 200 MB each.
- Folders are seeded (`SEED_TREE` in `backend/app/db.py`); there is no create/rename folder UI.

### API

| Method | Path | |
|---|---|---|
| GET | `/api/folders` | flat folder list with recursive `file_count` |
| GET | `/api/documents?folder_id=&recursive=` | files in a folder |
| POST | `/api/documents` | multipart `folder_id` + `files[]` |
| GET | `/api/documents/{id}/download` | file bytes as attachment |
| DELETE | `/api/documents/{id}` | remove a file |

### Tests

```bash
cd backend && .venv/bin/python -m pytest -q   # needs the docker DB running
```

## Project assistant

The **Ask** button (bottom right) opens a chat that answers questions about your inputs and results: assemblies, layers, materials, takeoff by level, and the Lateral site report. The browser sends a snapshot of the current project with each question to `POST /api/agent/chat`, which forwards it to an open-source model served over an OpenAI-compatible API (default: local Ollama, `llama3.1:8b`). Configure with `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` (see `.env.example`). The backend does not read `.env` itself, so export them in the shell that starts uvicorn. `GET /api/agent/status` reports whether the model server is reachable.
