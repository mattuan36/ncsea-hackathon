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

Wind, snow, and seismic site data come from the SkyCiv Load Generator. The client in `code/skyciv_load_generator.py` sends a latitude and longitude. Usage and the vendored API notes are in `docs/skyciv/README.md`. Put credentials in the environment or a local `API_Key.txt`; that file is gitignored.

To adapt it, replace `process()` with your workload and swap the fields in the sidebar
`st.form`; the caching and layout wiring stay unchanged.
