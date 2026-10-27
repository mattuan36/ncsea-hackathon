"""Build a small synthetic IFC4 model for tests: 2 storeys, 20 m x 12 m.

Not a client model. Layered wall and floor types like a Revit export:
  - "Basic Wall:Ext - Brick on 6in Stud": brick 3 5/8", air 1", 6" metal stud, 5/8" gypsum
  - "Floor:4in NWC on 2in Deck": 4" normal weight concrete, 2" metal deck
Each storey has 4 perimeter walls and one slab.

    python tests/make_ifc.py out.ifc
"""
from __future__ import annotations

import sys

import ifcopenshell
import ifcopenshell.api
import numpy as np

IN = 0.0254


def build(path: str) -> str:
    f = ifcopenshell.file(schema="IFC4")
    run = lambda cmd, **kw: ifcopenshell.api.run(cmd, f, **kw)  # noqa: E731
    project = run("root.create_entity", ifc_class="IfcProject", name="LTL test")
    run("unit.assign_unit")  # millimetres (geometry calls take metres and convert)
    ctx = run("context.add_context", context_type="Model")
    body = run("context.add_context", context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
    axis = run("context.add_context", context_type="Model", context_identifier="Axis", target_view="GRAPH_VIEW", parent=ctx)
    site = run("root.create_entity", ifc_class="IfcSite", name="Site")
    building = run("root.create_entity", ifc_class="IfcBuilding", name="Building")
    run("aggregate.assign_object", products=[site], relating_object=project)
    run("aggregate.assign_object", products=[building], relating_object=site)

    def material(name):
        return run("material.add_material", name=name)

    def layer_type(ifc_class, name, layers):
        t = run("root.create_entity", ifc_class=ifc_class, name=name)
        ls = run("material.add_material_set", name=name, set_type="IfcMaterialLayerSet")
        for mat, t_in in layers:
            layer = run("material.add_layer", layer_set=ls, material=material(mat))
            run("material.edit_layer", layer=layer, attributes={"LayerThickness": t_in * 25.4})
        run("material.assign_material", products=[t], material=ls)
        return t

    wall_t = layer_type("IfcWallType", "Basic Wall:Ext - Brick on 6in Stud",
                        [("Masonry - Brick", 3.625), ("Air", 1.0), ("Metal - Stud Layer", 6.0), ("Gypsum Wall Board", 0.625)])
    slab_t = layer_type("IfcSlabType", "Floor:4in NWC on 2in Deck",
                        [("Concrete, Normal Weight", 4.0), ("Metal - Deck", 2.0)])
    wall_th = (3.625 + 1 + 6 + 0.625) * IN
    slab_th = 6 * IN

    W, D, H = 20.0, 12.0, 4.0
    for i, name in enumerate(["Level 1", "Level 2"]):
        z = i * H
        storey = run("root.create_entity", ifc_class="IfcBuildingStorey", name=name)
        run("aggregate.assign_object", products=[storey], relating_object=building)
        run("geometry.edit_object_placement", product=storey, matrix=_at(0, 0, z))
        storey.Elevation = z

        for (x1, y1), (x2, y2) in [((0, 0), (W, 0)), ((W, 0), (W, D)), ((W, D), (0, D)), ((0, D), (0, 0))]:
            wall = run("root.create_entity", ifc_class="IfcWall", name=f"Basic Wall:Ext - Brick on 6in Stud:{100 + i}")
            run("type.assign_type", related_objects=[wall], relating_type=wall_t)
            length = float(np.hypot(x2 - x1, y2 - y1))
            angle = float(np.arctan2(y2 - y1, x2 - x1))
            m = _at(x1, y1, z, angle)
            run("geometry.edit_object_placement", product=wall, matrix=m)
            rep = run("geometry.add_wall_representation", context=body, length=length, height=H - slab_th, thickness=wall_th)
            run("geometry.assign_representation", product=wall, representation=rep)
            run("geometry.assign_representation", product=wall, representation=run(
                "geometry.add_axis_representation", context=axis, axis=[(0.0, 0.0), (length, 0.0)]))
            run("spatial.assign_container", products=[wall], relating_structure=storey)

        slab = run("root.create_entity", ifc_class="IfcSlab", name=f"Floor:4in NWC on 2in Deck:{200 + i}")
        slab.PredefinedType = "FLOOR"
        run("type.assign_type", related_objects=[slab], relating_type=slab_t)
        run("geometry.edit_object_placement", product=slab, matrix=_at(0, 0, z))
        rep = run("geometry.add_slab_representation", context=body, depth=slab_th,
                  polyline=[(0.0, 0.0), (W, 0.0), (W, D), (0.0, D)])
        run("geometry.assign_representation", product=slab, representation=rep)
        run("spatial.assign_container", products=[slab], relating_structure=storey)

    f.write(path)
    return path


def _at(x, y, z, angle=0.0):
    m = np.eye(4)
    c, s = np.cos(angle), np.sin(angle)
    m[:2, :2] = [[c, -s], [s, c]]
    m[:3, 3] = [x, y, z]
    return m


if __name__ == "__main__":
    print(build(sys.argv[1] if len(sys.argv) > 1 else "synthetic.ifc"))
