# Gravity dead load — IFC extraction and layer matching

Reads a Revit IFC export into the quantities the design-criteria UI needs, and proposes a dead-load database row for every layer. Standalone for now: nothing in `backend/` or `frontend/` imports it. The JSON below is the hand-off.

```bash
pip install -r requirements.txt

python ifc_extract.py model.ifc --db Dead_Load_Weights.xlsx -o out/model.json
python ifc_extract.py model.ifc --db Dead_Load_Weights.xlsx -o out/model_nogeo.json --no-geometry
python match_report.py out/*_nogeo.json --db Dead_Load_Weights.xlsx [--show matched|suggested|ambiguous]
streamlit run review_app.py
```

Dependencies: `ifcopenshell`, `shapely`, `numpy`, `openpyxl`. The review UI also uses `streamlit`, `plotly`, and `pandas`. Python 3.14 works.

A layer listed by unit weight becomes psf as

$$
w = \frac{\gamma \, t}{12}
$$

where \(\gamma\) is pcf and \(t\) is thickness in inches. A row that already stores psf is used as given. Per-inch spreadsheet formulas are resolved in `dl_db.py`.

## Files

| File | Role |
|---|---|
| `ifc_extract.py` | IFC to JSON: types, layers, instances, quantities, plan geometry, composite floor assemblies, typical-level groups |
| `matcher.py` | Regex rules from Revit layer material and thickness to a database row, with a status per layer. **`RULES` is what to tune.** |
| `dl_db.py` | Loads the weights spreadsheet (fixed psf, per-inch formula rows, ranges) plus the proposed zero-weight and allowance rows |
| `match_report.py` | Hit rate per model and the unresolved list, most-used first |
| `review_app.py` | Streamlit page: types table, walk-through, plan, match report |

## JSON contract (schema_version 1)

Lengths are feet, layer thickness is inches, areas are square feet. Plan XY is IFC world coordinates (Revit shared coordinates), in feet.

- `source` — file name, IFC schema, Revit version, export view definition.
- `levels[]` — `{id, name, elevation_ft}` for storeys that hold in-scope elements.
- `level_groups[]` — `{id, name, level_ids[], typical}`. Consecutive levels whose quantities match within 5% are grouped.
- `types[]` — one per Revit type. A type is split when its instances do not share a layer stack.
  - `kind` is `wall`, `curtain_wall`, `floor`, `roof`, or `ceiling`. `name` is `Family:Type`. Also `instances` and `levels[]`.
  - `layers[]` — `{material, thickness_in, match{status, material_class, row_id, psf, candidates[], note, structural}}`. Order is Revit order: walls exterior to interior, floors top to bottom.
  - `structural_guess` — `{layer_index, class, material, reason}`. `group` is the class used to group the walk-through.
  - `qty` — walls: `length_lf`, `net_area_sf` (openings removed), `gross_area_sf`, `avg_height_ft`. Floors: `plan_area_sf`, `top_area_sf` (sloped).
  - `psf_guess` is the sum of resolved layers. Also `layers_unresolved`, `duplicate_group`, and `most_similar{type_id, score}`.
  - `flags[]` — `finish_only`, `placeholder_material`, `no_layers`, `layer_thickness_unknown`, `layer_name_thickness_mismatch`.
- `duplicate_groups[]` — types with the same layer stack. These are auto-merge candidates.
- `composites[]` — floor assemblies after stacking: `{id, type_ids[] top to bottom, name, kinds[], plan_area_sf, levels[], psf_guess}`. A one-type composite uses that type's id.
- `plan{level_id}` — `zones[]` `{composite_id, type_ids, area_sf, polygons[{outer, holes}], label_xy}`, `walls[]` `{element_id, type_id, points, length_lf, height_ft, net_area_sf, base_z_ft}`, and `elements[]` (raw floor, roof, and ceiling footprints with z and `hung_from`).
- `excluded` — what was dropped, and why (area or mass slabs, fascia coverings).

## Match status

| Status | Meaning | UI |
|---|---|---|
| `matched` | One row. Keyword and thickness agree | Prefilled |
| `suggested` | One row, but verify it (nearest size, assumed 16 in. o.c., firm-vs-ASCE tie, or name and thickness disagree) | Prefilled and highlighted |
| `ambiguous` | Material is known and several rows fit, for example CMU grout | Dropdown filtered to `candidates`, nothing selected |
| `no_db_row` | Material is known and the database has no row (CFS studs, CLT, metal panel, EIFS, …) | Flag to add a row |
| `placeholder` | Revit "Default Wall" and similar | The user defines it |
| `unknown` | No rule matched | The user picks |
