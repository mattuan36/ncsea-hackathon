# Part 3 | ASCE 7-22 Seismic Cs & Base Shear (X / Y)

**Owner: Teammate C.** Run: `RUN_WINDOWS.bat`, or `uvicorn app:app --host 127.0.0.1 --port 8003`. Tests: `python -m pytest -q`.

Agent context for this folder: [CONTEXT.md](CONTEXT.md). Read it before changing the calculation, the code tables, or the Excel formulas.

PRELIMINARY tool. Not for design without review by the Engineer of Record. ASCE 7-22 only.

## Inputs
- **Part 1 `Hazard_Exchange` XLSX** or the Revit CSV (`parameter_name` / `BP_HZ_*`, `asce_edition` must be `7-22`): SDS, SD1, S1, TL; Risk Category, Site Class, SDC read if present. The page opens on `samples/Riverside_Office_Building_Hazard_Studio_Revit_Import.csv`.
- **Engineer:** Risk Category (if not imported), structural height hn (ft), stories above base (12.8.1.3 only), W (kips, optional).
- **Per direction (X and Y):** combination (single / horizontal / vertical), Table 12.2-1 system ID(s), analysis period T (optional),
  moment-frame confirmation, optional Table 12.8-2 type override.

## What it does
| Step | Provision |
|---|---|
| Ie from Risk Category | Table 1.5-2 |
| SDC = more severe of SDS and SD1 tables; S1 >= 0.75g -> E/F. The 11.6 exception is **not** applied. Mismatch with Part 1 -> warning | 11.6, Tables 11.6-1, 11.6-2 |
| R, Omega0, Cd; NP and height-limit warnings; footnote warnings | Table 12.2-1 (`data/table_12_2_1.json`) |
| Horizontal combination: least R; Omega0/Cd = largest among least-R systems | 12.2.3.3 |
| Vertical combination: lower R lower -> own coefficients + transfer amplification R_up/R_low; upper R lower -> upper coefficients for both | 12.2.3.1 |
| Ta = Ct hn^x; T = min(T_analysis, Cu Ta), or Ta if no analysis T | 12.8.2, Tables 12.8-1, 12.8-2 |
| Optional max SDS for Cs (engineer confirms regularity and rho = 1.0) | 12.8.1.3 - **value NOT VERIFIED, see code_tables.py** |
| Cs bounds; V = Cs W | 12.8.1.1, Eqs. 12.8-2 to 12.8-6 |

Warnings never block a result.

## Not checked
ELF eligibility (Table 12.6-1), irregularities, redundancy, 12.2.3.1 exceptions, 12.2.3.2 two-stage analysis,
12.2.3.3 exception, 12.2.5.4 height increases, alternate Ta equations, vertical distribution, CBC amendments.

## Engineering-judgment items to review
1. `code_tables.DEFAULT_PERIOD_TYPE`: mapping from Table 12.2-1 IDs to Table 12.8-2 types. Ambiguous systems default to "all other".
2. `code_tables.SDS_CAP_12_8_1_3` and its conditions: set `SDS_CAP_VERIFIED = True` only after checking the ASCE 7-22 text.
3. Cu is linearly interpolated in Table 12.8-1.
4. The 12.2.3.3 reading of Omega0/Cd for horizontal combinations.

## Table 12.2-1 data
`data/table_12_2_1.json` is generated from the team-verified workbook:
`python scripts/build_table_json.py ASCE7-22_Seismic_Tables.xlsx`. Never hand-edit the JSON. It records the source workbook SHA-256.

## Excel output
`Inputs` (blue = editable), `Cs & Base Shear` (formulas, X and Y columns), `Table 12.2-1`, `Code Tables`, `Imported ASCE`, `Review Notes`.
Changing inputs in Excel recalculates every result. **Warning text on Review Notes does not update after export.**
The Excel period type is the resolved key; changing a system ID in Excel does not change the Table 12.8-2 type.

## Endpoints
`GET /api/systems`, `POST /api/import` (multipart `xlsx`), `POST /api/calculate`, `POST /api/export`.
