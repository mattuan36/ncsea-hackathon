# Streamlit Starter

A minimal Streamlit boilerplate: sidebar inputs, a column-based workspace grid, and a
`st.session_state` cache that keeps processed results across reruns.

## Requirements

| | |
|---|---|
| Python | **3.12+** — `uv sync` uses **3.14** from `.python-version` |
| Streamlit | **1.66.1** (latest) — uses the current `width="stretch"` API, not the deprecated `use_container_width` |
| OS | Any (Windows, macOS, Linux) |

Packages and the virtual environment are defined with [uv](https://docs.astral.sh/uv/). Direct dependencies are pinned in `pyproject.toml`. `uv.lock` pins the full tree, including Streamlit's own dependencies. `.python-version` selects Python 3.14 for `uv sync`.

## Setup

Install uv, then create `.venv` and install the lockfile:

```bash
# https://docs.astral.sh/uv/getting-started/installation/
uv sync
cp .env.example .env
```

`uv sync` creates `.venv` in the repo root. That directory is gitignored.

## Run

```bash
uv run streamlit run app.py
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
pyproject.toml    # direct dependencies for uv
uv.lock           # locked environment
.env.example      # env template (copy to .env)
.python-version   # 3.14, used by uv sync
code/             # georeferenced SkyCiv Load Generator connector
docs/skyciv/      # Load Generator API documentation
```

## Load Generator

Wind, snow, and seismic site data come from the SkyCiv Load Generator. The client in `code/skyciv_load_generator.py` sends a latitude and longitude and prints one JSON document with `seismic`, `wind`, and `snow`. Usage and the vendored API notes are in `docs/skyciv/README.md`. Put credentials in `.env` or a local `API_Key.txt`; both are gitignored.

```bash
uv run python code/skyciv_load_generator.py \
  --lat 37.795143 \
  --lng -122.404312 \
  --design-code asce7-22 \
  --risk-category II \
  --site-class D \
  --output loads.json
```

To adapt it, replace `process()` with your workload and swap the fields in the sidebar
`st.form`; the caching and layout wiring stay unchanged.
