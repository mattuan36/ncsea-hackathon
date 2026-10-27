# Part 3 context — ASCE 7-22 seismic Cs and base shear

Load this file before editing `code/part3_seismic_base_shear/`. It is the contract for the calculation, the Part 1 workbook, and the Excel export. The module is preliminary. An Engineer of Record reviews it before design use.

## Place in the repo

Standalone FastAPI app, version `2.0.0`, port **8003**. It does not share a process with the documents API (8100) or the site API (8101), and the Lateral page does not call it.

`frontend/src/lateral/seismic.ts` classifies SDC only through D. This module also applies S1 ≥ 0.75g → SDC E (Risk Category I–III) or F (IV). Leave the Lateral page unchanged when editing Part 3.

`frontend/src/lateral/hazardExport.ts` writes the Revit CSV that `/api/import` also reads. Header: `parameter_name,value,units,description,preliminary,source_status,engineer_confirmed`. Mapped names are `BP_HZ_SDS`, `BP_HZ_SD1`, `BP_HZ_S1`, `BP_HZ_TL`, `BP_HZ_ASCE_EDITION`, `BP_HZ_RISK_CATEGORY`, `BP_HZ_SITE_CLASS`, `BP_HZ_SDC`, `BP_HZ_PROJECT_NUMBER`, and `BP_HZ_W_PRELIM`. Blank cells stay missing. The page default is `samples/Riverside_Office_Building_Hazard_Studio_Revit_Import.csv`. Leave the Lateral page code alone when editing Part 3.

## Rules that survive a refactor

- ASCE 7-22 only. `asce_edition` is the literal `7-22`. Any other edition fails at import.
- Warnings never block `calculate()`. A not-permitted system still returns Cs.
- Missing SDS, SD1, S1, or TL is an error. Do not coerce a missing hazard to zero.
- W is engineer-supplied. When it is absent, `base_shear_kips` and `base_shear_lbs` are null and `symbolic_base_shear` is `V = {Cs:.5f} x W`.
- Import does not set `engineer_reviewed`. The page starts that checkbox cleared.
- `SYNTHETIC_DEMO` and the files in `samples/` stay labeled not for design.
- Do not hand-edit `data/table_12_2_1.json`. Regenerate it with `python scripts/build_table_json.py <ASCE7-22_Seismic_Tables.xlsx>`. The JSON records the source workbook SHA-256. The loader expects **92** systems.
- Leave `SDS_CAP_VERIFIED = False` until a person has checked ASCE 7-22 Section 12.8.1.3 against the constants in `code_tables.py` and explicitly flips the flag.
- Do not invent R, Ω0, Cd, Cu, Ct, x, or Ie. They come from `code_tables.py` and the JSON.
- A provision change updates `calculation.py` and the matching Excel formula in `workbook.py` together. `test_workbook_formulas_and_cached_results` requires the cached Cs and V cells to equal `calculate()`.
- Run `python -m pytest -q` from this directory. The tests are the numerical contract. Do not loosen an assertion to make an edit pass.
- These provisions stay unimplemented until a task names them: Table 12.6-1 ELF eligibility, irregularities, redundancy, 12.2.3.1 exceptions, 12.2.3.2 two-stage analysis, the 12.2.3.3 exception, 12.2.5.4 height increases, alternate Ta equations, vertical distribution, CBC amendments.

## File map

| File | Responsibility |
|---|---|
| `app.py` | Routes only. No code math. |
| `calculation.py` | `SeismicInput`, `calculate()`, `cs_bounds()`. |
| `code_tables.py` | Ie, SDC, Cu, Table 12.8-2, 12.8.1.3 constants, JSON load. |
| `exchange.py` | Read schema `BP-HZ-1` from a Part 1 xlsx. |
| `workbook.py` | Formula workbook. Review Notes are frozen at export. |
| `static/index.html` | One page. Reset loads fictional demo values. |
| `scripts/build_table_json.py` | JSON generator. Reads sheet `Table 12.2-1` from row 5. |
| `tests/test_part3.py` | Tables, period, combinations, Cs, exchange, workbook, API. |

## Run

```bash
cd code/part3_seismic_base_shear
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
uvicorn app:app --host 127.0.0.1 --port 8003
```

Runtime: FastAPI, uvicorn, Pydantic v2, python-multipart, openpyxl. Tests also need pytest and httpx (`TestClient`).

## Input model

`SeismicInput` requires exactly one X and one Y direction.

| Combination | `system_ids` |
|---|---|
| `single` | exactly 1 id |
| `horizontal` | 2 to 4 ids, same direction |
| `vertical` | exactly `[upper, lower]` |

Unknown Table 12.2-1 ids are rejected. `period_analysis_sec` is optional, greater than 0, at most 30 s. `moment_frames_resist_100pct` defaults to false. `hn_ft` is in feet. `weight_kips` is optional. `source_status` is a string up to 70 characters; the import path is stricter than `calculate()`.

## Order inside `calculate()`

1. **Ie** from Table 1.5-2: I and II = 1.00, III = 1.25, IV = 1.50.
2. **SDC** is the more severe of Table 11.6-1 (SDS) and Table 11.6-2 (SD1). Lower edges are inclusive: 0.167 / 0.33 / 0.50 and 0.067 / 0.133 / 0.20. Risk Category IV uses the stricter column. S1 ≥ 0.75 overrides to E or F. The Section 11.6 exception is not applied, and a warning always says so. A `part1_sdc` mismatch warns and the Part 3 SDC is still returned. SDC A adds a warning that Section 11.7 governs.
3. **Coefficients**
   - Single: that system's R, Ω0, Cd.
   - Horizontal, Section 12.2.3.3: R is the least R. Ω0 and Cd are the largest values among the systems that have that R. A larger Ω0 or Cd on a non-governing system produces a confirmation warning. The 12.2.3.3 exception is not evaluated.
   - Vertical, Section 12.2.3.1: index 0 is the upper system, index 1 is the lower. If the lower R is smaller, design coefficients come from the lower system and `transfer_amplification` is R_upper / R_lower. Otherwise design coefficients come from the upper system and amplification is 1.0. `cs_upper_system` is Cs computed with the upper R. Exceptions and two-stage analysis are not evaluated.
4. **Height limits** for the computed SDC. SDC A skips Table 12.2-1 limits. `NP` and a numeric limit below `hn_ft` warn. When SDC is D, E, or F and the limit is 160 ft or 100 ft, the warning mentions Section 12.2.5.4 and does not apply it. Footnote `q` warns when hn < 60 ft. `other_footnotes` with no colon always warns. A value shaped `D, E, F: i` warns only when the computed SDC is in the text before the colon.
5. **Period type.** An engineer override wins. Otherwise the selected ids must map to one `DEFAULT_PERIOD_TYPE`; mixed types become `all_other`. Ids absent from the map are `all_other`. Moment-frame types (`steel_mf`, `concrete_mf`) become `all_other` unless `moment_frames_resist_100pct` is true. The default map is judgment: C1, C3, C4 → steel moment frame; C5, C6, C7 → concrete moment frame; B1, D1 → steel EBF; B26, D13 → steel BRBF. C2 and C8–C12 stay `all_other` on purpose.
6. **Period.** Ta = Ct · hn^x (Eq. 12.8-7 form, hn in feet). Cu comes from Table 12.8-1 with linear interpolation: SD1 ≥ 0.4 → 1.4, SD1 ≤ 0.1 → 1.7, and straight lines between 0.4/0.3/0.2/0.15/0.1. T used is the analysis period when it is provided and ≤ Cu·Ta, Cu·Ta when the analysis period exceeds the cap, and Ta when no analysis period is provided. The 12.8.6.2 drift note is a warning only.
7. **Section 12.8.1.3** runs only when every condition holds: the flag is on, regularity is confirmed, ρ = 1.0 is confirmed, stories above base ≤ 5, T used ≤ 0.5 s, Risk Category is I or II, and Site Class is present and is neither E nor F. SDS used for Cs is then min(SDS, `SDS_CAP_12_8_1_3`), which is 1.0 and **not verified**. Any failed condition leaves SDS unchanged and lists the reasons. While `SDS_CAP_VERIFIED` is false, applying the cap adds a warning.
8. **Cs**, Section 12.8.1.1. `den = R / Ie`.
   - Eq. 12.8-2: `cs_short = SDS_used / den`
   - Eq. 12.8-3 when T ≤ TL, else Eq. 12.8-4: `SD1 / (T · den)` or `SD1 · TL / (T² · den)`
   - Eq. 12.8-5: `max(0.044 · SDS_used · Ie, 0.01)`
   - Eq. 12.8-6 when S1 ≥ 0.6: `0.5 · S1 / den`, else 0
   - Cs = max(min(cs_short, cs_upper), max of the two minimums)
   - Governing label, with tolerance `1e-12`: `Minimum Cs`, else `Period upper limit`, else `SDS/(R/Ie)`.
9. **V** = Cs · W kips, and that value times 1000 for pounds.
10. When SDC is D, E, or F and T ≥ 3.5 · Ts (Ts = SD1 / SDS), warn that Table 12.6-1 may prohibit ELF. The tool does not decide eligibility.

## Exchange schema BP-HZ-1

Sheet name `Hazard_Exchange`. Row 1 is a header. Columns are key, value, unit, source, review. Keys are unique strings of at most 80 characters. Files larger than 6 MB are rejected.

Required keys: `schema_version` = `BP-HZ-1`, `asce_edition` = `7-22`, `source_status`, `engineer_confirmed`, `s1_g`, `sds_g`, `sd1_g`, `tl_sec`.

`read_exchange()` accepts `SYNTHETIC_DEMO`, `ASCE_API_UNVERIFIED`, and `SKYCIV_GETSITEDATA` (the SDS row of a Revit CSV). A file whose first bytes are `PK` is the workbook. Anything else must be a UTF-8 CSV with a `parameter_name` header. Required numbers must be real numbers ≥ 0, and TL must be > 0. Booleans and blank cells are rejected for SDS, SD1, S1, and TL. `ASCE 7-22` and `7-22` both mean edition `7-22`. The CSV path appends `sds_g`, `sd1_g`, `s1_g`, and `tl_sec` onto `exchange_rows` so the Excel export can link Inputs to Imported ASCE.

Optional keys: `project_number`, `risk_category` (blank unless it is I–IV), `site_class`, `sdc` (stored as `part1_sdc`).

The page uses one extra status that import will not accept. Editing an imported hazard sets `source_status` to `MANUAL_OVERRIDE_UNVERIFIED` and clears `exchange_rows`, so the export does not link Inputs to Imported ASCE. `calculate()` accepts that string because its field is free text.

## HTTP

| Method | Path | Body |
|---|---|---|
| GET | `/` | `static/index.html` |
| GET | `/api/health` | — |
| GET | `/api/systems` | 92 systems plus `default_period_type` and period-type labels |
| GET | `/api/default-hazard` | parsed Riverside CSV |
| POST | `/api/import` | multipart field `xlsx` holding an `.xlsx` or `.csv`; 422 with the `ValueError` text |
| POST | `/api/calculate` | `SeismicInput` JSON |
| POST | `/api/export` | `{inputs, exchange_rows}` → `results`, `filename`, `xlsx_base64` |

Export filename stem is the project number reduced to letters, digits, `-`, and `_`, at most 60 characters, or `PROJECT`.

## Workbook cell map

Sheet order, which the numeric cache depends on: **Inputs** = `xl/worksheets/sheet1.xml`, **Cs & Base Shear** = `sheet2.xml`, then Imported ASCE, Review Notes, Table 12.2-1, Code Tables. `_cache_numeric_formulas` raises if a cached address is missing. It writes a `<v>` beside the formula and leaves the formula in place.

Inputs column B, rows that formulas address by number:

| Row | Field |
|---|---|
| 9–12 | SDS, SD1, S1, TL. Linked to Imported ASCE when those keys were imported |
| 13 | Risk Category |
| 14 | Site Class |
| 15 | Part 1 SDC |
| 16 | hn (ft) |
| 17 | stories above base |
| 18 | W (kips) |
| 19–21 | 12.8.1.3 flag, regularity confirmation, ρ = 1.0 confirmation (`YES`/`NO`) |

Direction block, column B = X and column C = Y: row 24 combination, rows 25–28 system ids, row 29 analysis T, row 30 Table 12.8-2 type key. For a vertical combination, system 1 is upper and system 2 is lower. Empty system slots export as blank. Excel `MIN` ignores those text blanks. Do not write 0 into an unused slot.

Code Tables cells the formulas index:

- Ie: `A5:B8`
- Table 12.8-2 keys, Ct, x: `A11:D15`
- Section 12.8.1.3 cap value: `B17`
- Table 12.8-1 SD1 and Cu: `A22:B26`

The Cu formula in `workbook.py` (`_cu_formula`) is built against rows 22–26. Inserting rows above these blocks, or reordering sheets, breaks both Excel and the cache test.

Table 12.2-1 lookup columns: A = id, F = R, G = Ω0, H = Cd, I–M = height limits for SDC B through F. `NL` and `NP` are text.

Review Notes are a snapshot. Editing Inputs in Excel recalculates Cs and V. It does not refresh warning text. The exported period-type key stays as resolved at export; changing a system id in Excel does not change that key.

Text written into the workbook is quoted when it starts with `=`, `+`, `-`, or `@`.

## Anchors in `tests/test_part3.py`

Base fixture: SDS 0.85, SD1 0.55, S1 0.45, TL 8 s, Risk Category II, Site Class D, Part 1 SDC D, hn 60 ft, W 1500 kips, system B2 in both directions unless a test overrides it.

- C1 is R = 8, Ω0 = 3, Cd = 5.5. B3 height limit in SDC F is `NP`.
- Cu(0.25) = 1.45 and Cu(0.175) = 1.55.
- C1, analysis T = 1.2 s, moment frames confirmed, hn = 60: Ta = 0.028 · 60^0.8, T used = 1.4 · Ta, Cs = 0.55 / (T used · 8).
- Horizontal B2 + B26 → R 6, Ω0 2, Cd 5.
- Vertical upper B2 (R 6) over lower A1 (R 5) → design R 5, amplification 1.2, Cs = 0.85/5, upper Cs = 0.85/6.
- Vertical upper A16 (R 6.5, Ω0 3) over lower C5 (R 8) → design R 6.5, Ω0 3, amplification 1.
- The 12.8.1.3 fixture uses SDS 1.6. The cap result equals `SDS_CAP_12_8_1_3` only when every condition holds. Risk Category III, 6 stories, Site Class E, or an unconfirmed ρ each leave SDS at 1.6.

## Reviewer-owned judgment

`DEFAULT_PERIOD_TYPE`, the unverified 12.8.1.3 cap value and its conditions, linear interpolation of Cu, and the reading of Ω0/Cd for a horizontal combination. Record a review in code (`SDS_CAP_VERIFIED`) or in the table workbook verification log. Do not mark a judgment resolved from inside an agent session.
