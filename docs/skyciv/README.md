# SkyCiv Load Generator

Georeferenced wind, snow, and seismic checks for this project go through the SkyCiv Load Generator API. The client is [`code/skyciv_load_generator.py`](../../code/skyciv_load_generator.py). It always sends `lat` and `lng`. It does not geocode a street address.

## Documentation in this folder

These files are copied from [skyciv/skyciv-ai-skills](https://github.com/skyciv/skyciv-ai-skills) under the MIT license in [`LICENSE`](LICENSE) (Copyright (c) 2026 SkyCiv Pty Ltd).

| File | What it is |
|---|---|
| [`load-gen-api/SKILL.md`](load-gen-api/SKILL.md) | Load Generator functions, design codes, and request shape |
| [`skyciv-api-v3/SKILL.md`](skyciv-api-v3/SKILL.md) | Auth, the POST envelope, and how to read `response.status` |

The published page for the load skill is <https://skyciv.com/api/v3/docs/ai-skill-loads>. Upstream sample requests and responses live in `load-gen-api/sample-api/` on that GitHub repo and are not copied here.

## Call

`POST https://api.skyciv.com/v3` with `Content-Type: application/json`.

Every load call starts with `standalone.loads.start`. `S3D.session.start` does not open a Load Generator session. The next function is `standalone.loads.getSiteData` for site values, or `standalone.loads.getLoads` for pressures on a building.

`getSiteData` arguments used by the connector:

```json
{
  "function": "standalone.loads.getSiteData",
  "arguments": {
    "site_data": {
      "design_code": "asce7-22",
      "lat": 37.795143,
      "lng": -122.404312,
      "risk_category": "II",
      "site_class": "D"
    },
    "api_version": 2.1
  }
}
```

For a US site, `asce7-22` returns wind, snow, and seismic. `asce7-16` does too. Pass `site_class` or `seismic_data` comes back empty.

## Credentials

Set `SKYCIV_USERNAME` and `SKYCIV_KEY` in the environment, or copy `.env.example` to `.env`. A local `API_Key.txt` at the repo root is also read, with `USERNAME` and `SKY_CIV_KEY`. That file is gitignored. Do not commit a key.

## Environment

From the repo root, `uv sync` creates `.venv` from `pyproject.toml`, `uv.lock`, and `.python-version`. Run the connector with `uv run` so `python-dotenv` can load `.env`.

## JSON output

A site check writes one JSON object. The data keys are `seismic`, `wind`, and `snow`. `site` records the coordinate that was sent and the address SkyCiv resolved. `--full` adds `seismic.spectra`. `--output loads.json` writes the file instead of stdout.

`wind.wind_speed` is `all_wind_speed` for the requested risk category. On the Kearny Street check the API's own scalar `wind_speed` was the Category IV value, so the connector does not copy that scalar through unchanged.

```bash
uv run python code/skyciv_load_generator.py \
  --lat 37.795143 \
  --lng -122.404312 \
  --design-code asce7-22 \
  --risk-category II \
  --site-class D \
  --output loads.json
```

Recorded ASCE 7-22 output for that coordinate, Risk Category II, Site Class D. Spectra are omitted here; `--full` adds them under `seismic.spectra`.

```json
{
  "seismic": {
    "ss": 1.5,
    "s1": 0.6,
    "sms": 1.63,
    "sm1": 1.7,
    "sds": 1.09,
    "sd1": 1.13,
    "sdc": "D",
    "pgam": 0.55,
    "ts": 1.04,
    "t0": 0.209,
    "tl": 12
  },
  "wind": {
    "wind_speed": 92,
    "wind_speed_unit": "mph",
    "all_wind_speed": {
      "I": 87,
      "II": 92,
      "III": 99,
      "IV": 103,
      "10-year": 61,
      "25-year": 68,
      "50-year": 73,
      "100-year": 78
    }
  },
  "snow": {
    "snow_load": "not available",
    "w2": 0.25
  },
  "site": {
    "latitude": 37.795143,
    "longitude": -122.404312,
    "address": "750 Kearny St, San Francisco, CA 94108, USA",
    "elevation_m": 7.15,
    "design_code": "asce7-22",
    "risk_category": "II",
    "site_class": "D"
  }
}
```

From Python, put the `code` directory on `sys.path` and import `skyciv_load_generator`. The folder is not a package: the name `code` is already a Python standard-library module. `SiteLoads.as_json()` returns the same document.

## Checked site

Coordinates `37.795143, -122.404312` resolve to 750 Kearny St, San Francisco, CA 94108, elevation 7.15 m. The figures below use Risk Category II and Site Class D.

ASCE 7-22: Ss 1.50, S1 0.60, SMS 1.63, SM1 1.70, SDS 1.09, SD1 1.13, seismic design category D, TL 12 s. The multi-period design spectrum peaks near 1.21 g at about 0.4 s.

ASCE 7-16: Ss 1.50, S1 0.60, Fa 1.0, SMS 1.50, SDS 1.00, short-period category D. Fv, SM1, and SD1 are omitted, with the note to see ASCE 7-16 Section 11.4.8, because S1 is at least 0.2 on Site Class D.

Each `getSiteData` call spends SkyCiv API credits.
