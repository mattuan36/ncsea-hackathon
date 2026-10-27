# Gravity DL — IFC extraction + layer matching MVP

Proves we can get what the design criteria UI needs out of a Revit IFC export, and
gives a first guess of the dead load database row for every layer. Standalone for now:
nothing in `backend/` or `frontend/` imports it yet; the JSON below is the hand-off.

```
pip install -r requirements.txt

python ifc_extract.py model.ifc --db Dead_Load_Weights.xlsx -o out/model.json   # full run
python ifc_extract.py model.ifc --db ... -o out/model_nogeo.json --no-geometry  # types/layers only, fast
python match_report.py out/*_nogeo.json --db Dead_Load_Weights.xlsx [--show matched|suggested|ambiguous]
streamlit run review_app.py                                                      # throwaway review UI
```

Deps: `ifcopenshell shapely numpy openpyxl` (+ `streamlit plotly pandas` for the review UI). Python 3.14 works.

| file | what |
|---|---|
| `ifc_extract.py` | IFC → JSON: types, layers, instances, quantities, plan geometry, composite floor assemblies, typical-level groups |
| `matcher.py` | regex rules: Revit layer material + thickness → DB row, with a status per layer. **`RULES` is the thing to tune.** |
| `dl_db.py` | loads Kim's spreadsheet (fixed psf, per-inch formula rows, ranges) + proposed zero-weight/allowance rows |
| `match_report.py` | hit-rate per model and the unresolved list, most-used first |
| `review_app.py` | Streamlit page to eyeball the data (types table, walk-through, plan, match report) |

## JSON contract (schema_version 1) — what the React UI can build against

All lengths ft, layer thickness in, areas sf. Plan XY = IFC world coordinates (Revit shared coordinates) in ft.

- `source` — file name, IFC schema, Revit version, export view definition.
- `levels[]` — `{id, name, elevation_ft}`; only storeys that hold in-scope elements.
- `level_groups[]` — `{id, name, level_ids[], typical}`; consecutive levels whose quantities match within 5% are grouped.
- `types[]` — one per Revit type (split if instances of one type have different layer stacks):
  - `kind` wall | curtain_wall | floor | roof | ceiling; `name` "Family:Type"; `instances`; `levels[]`
  - `layers[]` `{material, thickness_in, match{status, material_class, row_id, psf, candidates[], note, structural}}` —
    Revit order (walls exterior → interior, floors top → bottom)
  - `structural_guess` `{layer_index, class, material, reason}` and `group` (class used to group the walk-through)
  - `qty` — walls: `length_lf, net_area_sf` (openings removed), `gross_area_sf, avg_height_ft`; floors: `plan_area_sf, top_area_sf` (sloped)
  - `psf_guess` (sum of resolved layers), `layers_unresolved`, `duplicate_group`, `most_similar{type_id, score}`
  - `flags[]` — `finish_only`, `placeholder_material`, `no_layers`, `layer_thickness_unknown`, `layer_name_thickness_mismatch`
- `duplicate_groups[]` — types with identical layer stacks (auto-merge candidates).
- `composites[]` — floor assemblies after stacking (option b): `{id, type_ids[] top→bottom, name, kinds[], plan_area_sf, levels[], psf_guess}`.
  A composite with one type has the type's id.
- `plan{level_id}` — `zones[]` `{composite_id, type_ids, area_sf, polygons[{outer, holes}], label_xy}`,
  `walls[]` `{element_id, type_id, points, length_lf, height_ft, net_area_sf, base_z_ft}`,
  `elements[]` (raw floor/roof/ceiling footprints with z and `hung_from`).
- `excluded` — what was dropped and why (area/mass slabs, fascia coverings).

## Match status meaning (UI colour)

| status | meaning | UI |
|---|---|---|
| matched | one row, keyword + thickness agree | prefilled |
| suggested | one row picked but verify (nearest size, assumed 16" o.c., firm-vs-ASCE tie, name/thickness disagree) | prefilled, highlighted |
| ambiguous | material known, several rows fit (e.g. CMU grout) | dropdown pre-filtered to `candidates`, no pick |
| no_db_row | material known, DB has no row (CFS studs, CLT, metal panel, EIFS...) | flag to add a row |
| placeholder | Revit "Default Wall" etc. | user defines |
| unknown | no rule matched | user picks |
