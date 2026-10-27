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

## Run a site check

```bash
python code/skyciv_load_generator.py \
  --lat 37.795143 \
  --lng -122.404312 \
  --design-code asce7-22 \
  --risk-category II \
  --site-class D
```

Add `--full` to include the response spectra. From Python, put the `code` directory on `sys.path` and import `skyciv_load_generator`. The folder is not a package: the name `code` is already a Python standard-library module.

`wind_data.all_wind_speed` is keyed by risk category. On the Kearny Street check the scalar `wind_data.wind_speed` was the Category IV speed, not the category requested. The connector reports `all_wind_speed` for the requested category.

## Checked site

Coordinates `37.795143, -122.404312` resolve to 750 Kearny St, San Francisco, CA 94108, elevation 7.15 m. The figures below use Risk Category II and Site Class D.

ASCE 7-22: Ss 1.50, S1 0.60, SMS 1.63, SM1 1.70, SDS 1.09, SD1 1.13, seismic design category D, TL 12 s. The multi-period design spectrum peaks near 1.21 g at about 0.4 s.

ASCE 7-16: Ss 1.50, S1 0.60, Fa 1.0, SMS 1.50, SDS 1.00, short-period category D. Fv, SM1, and SD1 are omitted, with the note to see ASCE 7-16 Section 11.4.8, because S1 is at least 0.2 on Site Class D.

Each `getSiteData` call spends SkyCiv API credits.
