# Part 3 — ASCE 7-22 seismic Cs and base shear

**Owner: Teammate C.** Run with `RUN_WINDOWS.bat`, or:

```bash
uvicorn app:app --host 127.0.0.1 --port 8003
python -m pytest -q
```

Read [CONTEXT.md](CONTEXT.md) before changing the calculation, the code tables, or the Excel formulas.

Preliminary only. Not for design until the engineer of record reviews it. ASCE 7-22 only.

## Equations

Section 12.8.1.1. \(C_s\) is the larger of the lower bound and the lesser of Eq. 12.8-2 and the period limit. \(V = C_s W\).

$$
C_s = \frac{S_{DS}}{R/I_e}
\qquad
C_s \le
\begin{cases}
S_{D1} / \big(T (R/I_e)\big) & T \le T_L \\
S_{D1} T_L / \big(T^{2} (R/I_e)\big) & T > T_L
\end{cases}
$$

$$
C_s \ge \max(0.044 \, S_{DS} I_e,\; 0.01)
\qquad
C_s \ge \frac{0.5 \, S_1}{R/I_e} \quad (S_1 \ge 0.6)
$$

Section 12.8.2:

$$
T_a = C_t h_n^{x}
\qquad
T = \min(T_{\mathrm{analysis}},\; C_u T_a)
$$

If no analysis period is given, \(T = T_a\). Blank \(W\) stays blank. It is not zero.

## Inputs

- **Part 1 `Hazard_Exchange` XLSX**, or the Revit CSV (`parameter_name` / `BP_HZ_*`). `asce_edition` must be `7-22`. The file supplies SDS, SD1, S1, and TL. Risk category, site class, and SDC are read when present. The page opens on `samples/Riverside_Office_Building_Hazard_Studio_Revit_Import.csv`.
- **Engineer:** risk category when it was not imported, structural height \(h_n\) (ft), stories above base (12.8.1.3 only), and \(W\) (kips, optional).
- **Each direction (X and Y):** combination (single, horizontal, or vertical), Table 12.2-1 system id(s), analysis period \(T\) (optional), moment-frame confirmation, and an optional Table 12.8-2 type override.

## What it checks

| Step | Provision |
|---|---|
| \(I_e\) from risk category | Table 1.5-2 |
| SDC is the more severe of the SDS and SD1 tables. \(S_1 \ge 0.75g\) forces E or F. The 11.6 exception is not applied. A mismatch with Part 1 is a warning | 11.6, Tables 11.6-1 and 11.6-2 |
| \(R\), \(\Omega_0\), \(C_d\); NP and height-limit warnings; footnote warnings | Table 12.2-1 (`data/table_12_2_1.json`) |
| Horizontal combination: least \(R\). \(\Omega_0\) and \(C_d\) are the largest among the systems that have that \(R\) | 12.2.3.3 |
| Vertical combination: lower \(R\) on the lower system uses each system's own coefficients, and transferred force is amplified by \(R_{up}/R_{low}\). Lower or equal \(R\) on the upper system uses the upper coefficients for both | 12.2.3.1 |
| \(T_a = C_t h_n^x\). \(T\) is the analysis period capped at \(C_u T_a\), or \(T_a\) when no analysis period is given | 12.8.2, Tables 12.8-1 and 12.8-2 |
| Optional maximum SDS for Cs. The engineer confirms regularity and \(\rho = 1.0\) | 12.8.1.3. The cap value is **not verified**. See `code_tables.py` |
| Cs bounds and \(V = C_s W\) | 12.8.1.1, Eqs. 12.8-2 through 12.8-6 |

Warnings never block a result.

## Not checked

ELF eligibility (Table 12.6-1), irregularities, redundancy, the 12.2.3.1 exceptions, 12.2.3.2 two-stage analysis, the 12.2.3.3 exception, 12.2.5.4 height increases, alternate \(T_a\) equations, vertical distribution, and CBC amendments.

## Review before relying on a number

1. `code_tables.DEFAULT_PERIOD_TYPE` maps Table 12.2-1 ids to Table 12.8-2 types. Ambiguous systems default to "all other".
2. `code_tables.SDS_CAP_12_8_1_3` and its conditions. Set `SDS_CAP_VERIFIED = True` only after checking the ASCE 7-22 text.
3. \(C_u\) is linearly interpolated from Table 12.8-1.
4. The 12.2.3.3 reading of \(\Omega_0\) and \(C_d\) for a horizontal combination.

## Table 12.2-1

`data/table_12_2_1.json` is generated from the team-verified workbook:

```bash
python scripts/build_table_json.py ASCE7-22_Seismic_Tables.xlsx
```

Do not hand-edit the JSON. The file records the source workbook SHA-256.

## Excel output

`Inputs` (blue cells are editable), `Cs & Base Shear` (formulas, X and Y columns), `Table 12.2-1`, `Code Tables`, `Imported ASCE`, `Review Notes`.

Changing inputs in Excel recalculates every result. Warning text on Review Notes does not update after export. The Excel period type is the resolved key. Changing a system id in Excel does not change the Table 12.8-2 type.

## Endpoints

`GET /api/systems`, `POST /api/import` (multipart `xlsx` or the Revit CSV), `POST /api/calculate`, `POST /api/export`.
