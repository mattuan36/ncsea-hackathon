# Streamlit Starter

A minimal Streamlit boilerplate: sidebar inputs, a column-based workspace grid, and a
`st.session_state` cache that keeps processed results across reruns.

## Requirements

| | |
|---|---|
| Python | **3.11+** — tested on **3.14.3** (see `.python-version`) |
| Streamlit | **1.66.1** (latest) — uses the current `width="stretch"` API, not the deprecated `use_container_width` |
| OS | Any (Windows, macOS, Linux) |

All Python packages are pinned in `requirements.txt`. Streamlit pulls in its own
dependencies (Altair, PyArrow, Tornado, …) automatically.

## Setup

```powershell
# 1. Create and activate a virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1          # Windows PowerShell
# source venv/bin/activate           # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create your local environment file
Copy-Item .env.example .env          # Windows
# cp .env.example .env               # macOS / Linux
```

## Run

```powershell
streamlit run app.py
```

Open <http://localhost:8501>. The sidebar controls the inputs; **Run** applies them,
and the result is cached in `st.session_state` until you change inputs or clear the cache.

## Configuration

`.env` (git-ignored) is loaded with `python-dotenv` at startup:

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `Streamlit Starter` | Title shown in the sidebar and page tab |
| `DATA_SOURCE` | `demo` | Label shown in the sidebar |
| `API_KEY` | — | Server-side secret; read with `os.getenv("API_KEY")`, never render it |
| `SKYCIV_USERNAME` | — | SkyCiv account email for the Load Generator |
| `SKYCIV_KEY` | — | SkyCiv API key; never render it or commit it |

If you deploy to Streamlit Community Cloud, put the same keys in `.streamlit/secrets.toml`
(also git-ignored) or the app's secrets manager.

## Layout

```
app.py            # inputs → process() → session_state cache → workspace grid
requirements.txt  # pinned Python dependencies
.env.example      # env template (copy to .env)
.python-version   # 3.14, for pyenv/asdf users
code/             # georeferenced SkyCiv Load Generator connector
docs/skyciv/      # Load Generator API documentation
```

## Load Generator

Wind, snow, and seismic site data come from the SkyCiv Load Generator. The client in `code/skyciv_load_generator.py` sends a latitude and longitude and prints one JSON document with `seismic`, `wind`, and `snow`. Usage and the vendored API notes are in `docs/skyciv/README.md`. Put credentials in `.env` or a local `API_Key.txt`; both are gitignored.

```bash
python code/skyciv_load_generator.py \
  --lat 37.795143 \
  --lng -122.404312 \
  --design-code asce7-22 \
  --risk-category II \
  --site-class D \
  --output loads.json
```

To adapt it, replace `process()` with your workload and swap the fields in the sidebar
`st.form`; the caching and layout wiring stay unchanged.

---

## LightenTheLoad web app (working name)

React (Vite + TypeScript) frontend, Python (FastAPI) backend, PostgreSQL storage.

The published site is [https://mattuan36.github.io/ncsea-hackathon/](https://mattuan36.github.io/ncsea-hackathon/). A push to `main` builds `frontend/` and deploys it with GitHub Pages. The Lateral report runs in the browser. Documents still needs the local API.

Menus: **Analytics, Documents, Settings, Lateral, Gravity, Reports**.

| Menu | State |
|---|---|
| Documents | Working: upload / download / delete, stored in Postgres |
| Gravity | **Wireframe** — dead-load takeoff wizard (6 steps, below) |
| Reports | **Wireframe** — graphical output sheets + spreadsheet layout preview |
| Settings | **Wireframe** — project info + material database |
| Analytics | **Wireframe** — takeoff summary (KPIs, dead load by assembly) |
| Lateral | Site wind, snow, and seismic report. Search or drop a pin in the United States, Alaska, or Puerto Rico, then enter a SkyCiv username and API key in the page. The key is not stored in the repo. |

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
