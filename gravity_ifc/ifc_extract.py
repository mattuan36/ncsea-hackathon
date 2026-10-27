"""Extract wall / floor / roof / ceiling assemblies from a Revit IFC export into JSON.

    python ifc_extract.py model.ifc --db Dead_Load_Weights.xlsx -o model.json [--no-geometry]

Everything is in feet / inches / sf / lf. Plan coordinates are the IFC world
XY (Revit shared coordinates in the exports seen so far), in feet.

Output shape (see README.md for the full field list):
    source, levels, level_groups, types, composites, plan, excluded, stats
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing
import re
import sys
import time
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ue
import ifcopenshell.util.placement as up
import ifcopenshell.util.unit as uu
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString
from shapely.ops import polygonize, unary_union

from dl_db import load_db
from matcher import Matcher, structural_guess, normalize, inches_in_name

M_PER_FT = 0.3048
MAX_CEILING_GAP_FT = 12.0     # ceiling must sit within this distance below the floor it hangs from
SIMPLIFY_FT = 0.05
STACK_TOL_FT = 0.5            # floor elements closer than this vertically are one assembly stack


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- element selection

def classify(e) -> tuple[str | None, str | None]:
    """(kind, exclusion reason). kind in wall/curtain_wall/floor/roof/ceiling."""
    if e.is_a("IfcCurtainWall"):
        return "curtain_wall", None
    if e.is_a("IfcWall"):
        return "wall", None
    if e.is_a("IfcRoof"):
        return "roof", None
    if e.is_a("IfcSlab"):
        pred = (e.PredefinedType or "").upper()
        if pred == "ROOF":
            return "roof", None
        reps = {r.RepresentationType for r in e.Representation.Representations} if e.Representation else set()
        if ue.get_material(e) is None and (ue.get_type(e) is None or reps <= {"SurfaceModel"}):
            return None, "slab with no material (area/mass object, not an assembly)"
        return "floor", None
    if e.is_a("IfcCovering"):
        pred = (e.PredefinedType or "").upper()
        if pred == "CEILING":
            return "ceiling", None
        if pred == "FLOORING":
            return "floor", None
        return None, f"covering {pred or 'NOTDEFINED'} (fascia/trim, not a gravity assembly)"
    return None, "not in scope"


def type_name(e) -> str:
    t = ue.get_type(e)
    if t is not None and t.Name:
        return t.Name
    name = e.Name or e.is_a()
    head, _, tail = name.rpartition(":")
    return head if tail.isdigit() and head else name  # Revit: "Family:Type:ElementId"


def storey_of(e):
    """Walk containment / aggregation up to the IfcBuildingStorey (ceilings can sit in IfcSpace)."""
    cur, seen = e, 0
    while cur is not None and seen < 8:
        if cur.is_a("IfcBuildingStorey"):
            return cur
        nxt = ue.get_container(cur) or ue.get_aggregate(cur)
        cur, seen = nxt, seen + 1
    return None


# ---------------------------------------------------------------- materials

def length_to_in(v, unit_scale):
    return v * unit_scale / 0.0254


def layers_of(e, unit_scale) -> tuple[list[dict], str]:
    """Material layers of an element (or its type). Returns (layers, material_source)."""
    mat = ue.get_material(e, should_skip_usage=True)
    if mat is None and ue.get_type(e) is not None:
        mat = ue.get_material(ue.get_type(e), should_skip_usage=True)
    if mat is None:
        return [], "none"
    if mat.is_a("IfcMaterialLayerSet"):
        return [{"material": (l.Material.Name if l.Material else "<Unnamed>"),
                 "thickness_in": round(length_to_in(l.LayerThickness, unit_scale), 4)} for l in mat.MaterialLayers], "layer_set"
    if mat.is_a("IfcMaterialList"):
        return [{"material": m.Name, "thickness_in": None} for m in mat.Materials], "list"
    if mat.is_a("IfcMaterial"):
        return [{"material": mat.Name, "thickness_in": None}], "single"
    return [], mat.is_a()


def signature(layers) -> tuple:
    return tuple((normalize(l["material"]), round(l["thickness_in"] or 0, 3)) for l in layers)


# ---------------------------------------------------------------- geometry

def geom_settings():
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    return s


def iterate_shapes(f, elements):
    """Yield (element id, verts Nx3 in ft, faces Mx3)."""
    it = ifcopenshell.geom.iterator(geom_settings(), f, multiprocessing.cpu_count(), include=elements)
    if not it.initialize():
        return
    while True:
        shape = it.get()
        g = shape.geometry
        verts = np.asarray(g.verts, dtype=float).reshape(-1, 3) / M_PER_FT
        faces = np.asarray(g.faces, dtype=np.int64).reshape(-1, 3)
        yield shape.id, verts, faces
        if not it.next():
            break


def mesh_stats(verts, faces):
    if len(faces) == 0:
        return None
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    cross = np.cross(b - a, c - a)
    tri_area = np.linalg.norm(cross, axis=1) / 2
    volume = abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6
    with np.errstate(invalid="ignore", divide="ignore"):
        nz = np.where(tri_area > 0, cross[:, 2] / (2 * tri_area), 0)
    up_mask = nz > 0.1
    return {
        "zmin": float(verts[:, 2].min()), "zmax": float(verts[:, 2].max()),
        "volume_cf": float(volume),
        "top_area_sf": float(tri_area[up_mask].sum()),   # true (sloped) top surface
        "tris_up": (a[up_mask], b[up_mask], c[up_mask]),
    }


def footprint(tris_up) -> MultiPolygon | None:
    a, b, c = tris_up
    if len(a) == 0:
        return None
    polys = [Polygon([p[:2], q[:2], r[:2]]) for p, q, r in zip(a, b, c)]
    polys = [p for p in polys if p.is_valid and p.area > 1e-4]
    if not polys:
        return None
    fp = unary_union(polys).buffer(0.01).buffer(-0.01).simplify(SIMPLIFY_FT)
    if fp.is_empty:
        return None
    return fp if isinstance(fp, MultiPolygon) else MultiPolygon([fp]) if isinstance(fp, Polygon) else None


def wall_axis(e, unit_scale):
    """World-space centreline polyline (ft) from the wall's Axis representation."""
    if not e.Representation:
        return None
    for rep in e.Representation.Representations:
        if rep.RepresentationIdentifier != "Axis":
            continue
        item = rep.Items[0]
        if not item.is_a("IfcPolyline"):
            return None  # arcs (IfcTrimmedCurve): fall back to the mesh
        pts = np.array([list(p.Coordinates)[:2] + [0.0] for p in item.Points], dtype=float)
        m = up.get_local_placement(e.ObjectPlacement)  # file units
        world = (m @ np.c_[pts, np.ones(len(pts))].T).T[:, :2]
        return world * unit_scale / M_PER_FT
    return None


def long_axis_line(verts):
    """Fallback centreline: long side of the min-area rectangle around the plan points."""
    hull = shapely.MultiPoint(verts[:, :2]).convex_hull
    if hull.geom_type != "Polygon":
        return np.array(hull.coords) if hull.geom_type == "LineString" else None
    rect = np.array(hull.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = rect[1] - rect[0], rect[2] - rect[1]
    if np.linalg.norm(e1) >= np.linalg.norm(e2):
        return np.array([(rect[0] + rect[3]) / 2, (rect[1] + rect[2]) / 2])
    return np.array([(rect[0] + rect[1]) / 2, (rect[3] + rect[2]) / 2])


def polyline_len(pts):
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()) if pts is not None and len(pts) > 1 else 0.0


def poly_coords(mp: MultiPolygon):
    out = []
    for p in mp.geoms:
        out.append({"outer": [[round(x, 2), round(y, 2)] for x, y in p.exterior.coords],
                    "holes": [[[round(x, 2), round(y, 2)] for x, y in r.coords] for r in p.interiors]})
    return out


# ---------------------------------------------------------------- main extraction

def extract(path: str, db_path: str | None, with_geometry: bool = True, db_rows: list | None = None) -> dict:
    """db_rows: DbRow list to match against instead of reading db_path (the web app passes its materials table)."""
    t0 = time.time()
    f = ifcopenshell.open(path)
    log(f"opened {Path(path).name} ({f.schema}) in {time.time() - t0:.0f}s")
    unit_scale = uu.calculate_unit_scale(f)  # metres per file length unit
    rows = db_rows if db_rows is not None else (load_db(db_path) if db_path else None)
    matcher = Matcher(rows) if rows is not None else None

    storeys = sorted(f.by_type("IfcBuildingStorey"),
                     key=lambda s: up.get_local_placement(s.ObjectPlacement)[2, 3] if s.ObjectPlacement else (s.Elevation or 0))
    storey_elev = {s.id(): (up.get_local_placement(s.ObjectPlacement)[2, 3] * unit_scale / M_PER_FT
                            if s.ObjectPlacement else (s.Elevation or 0) * unit_scale / M_PER_FT) for s in storeys}

    # ---- collect in-scope elements; roof parts inherit from their IfcRoof
    elements, excluded = [], Counter()
    roof_children: dict[int, list] = {}
    child_ids = set()
    for r in f.by_type("IfcRoof"):
        kids = [k for k in ue.get_decomposition(r) if k.is_a("IfcSlab")]
        if kids:
            roof_children[r.id()] = kids
            child_ids.update(k.id() for k in kids)
    for cls in ("IfcWall", "IfcCurtainWall", "IfcSlab", "IfcRoof", "IfcCovering"):
        for e in f.by_type(cls):
            if e.id() in child_ids:
                continue
            kind, why = classify(e)
            if kind is None:
                excluded[f"{e.is_a()}: {why}"] += 1
                continue
            elements.append((e, kind))
    log(f"{len(elements)} in-scope elements, {sum(excluded.values())} excluded")

    # ---- types
    types: dict[str, dict] = {}
    elem_type: dict[int, str] = {}
    for e, kind in elements:
        layers, msrc = layers_of(e, unit_scale)
        if not layers and e.id() in roof_children:
            layers, msrc = layers_of(roof_children[e.id()][0], unit_scale)
        tname = type_name(e)
        sig = signature(layers)
        key = f"{kind}|{tname}|{sig}"
        tid = "T" + hashlib.md5(key.encode()).hexdigest()[:8]
        if tid not in types:
            variants = sum(1 for t in types.values() if t["name"] == tname and t["kind"] == kind)
            types[tid] = {
                "id": tid, "kind": kind, "name": tname + (f" [variant {variants + 1}]" if variants else ""),
                "family": tname.split(":")[0] if ":" in tname else "", "ifc_class": e.is_a(),
                "predefined_type": getattr(e, "PredefinedType", None),
                "material_source": msrc, "layers": layers, "instances": 0,
                "element_ids": [], "flags": [],
            }
        types[tid]["instances"] += 1
        types[tid]["element_ids"].append(e.id())
        elem_type[e.id()] = tid

    # ---- geometry + quantities per element
    elem_geo: dict[int, dict] = {}
    if with_geometry:
        t1 = time.time()
        geo_targets = []
        for e, kind in elements:
            geo_targets += roof_children.get(e.id(), [e])
            if kind == "curtain_wall":
                geo_targets += [k for k in ue.get_decomposition(e)]
        parent_of = {k.id(): r for r, kids in roof_children.items() for k in kids}
        for e, kind in elements:
            if kind == "curtain_wall":
                for k in ue.get_decomposition(e):
                    parent_of[k.id()] = e.id()
        raw = defaultdict(list)
        n = 0
        for eid, verts, faces in iterate_shapes(f, geo_targets):
            raw[parent_of.get(eid, eid)].append((verts, faces))
            n += 1
            if n % 2000 == 0:
                log(f"  meshed {n}/{len(geo_targets)}")
        log(f"meshed {n} shapes in {time.time() - t1:.0f}s")

        by_id = {e.id(): (e, k) for e, k in elements}
        for eid, parts in raw.items():
            e, kind = by_id[eid]
            verts = np.vstack([p[0] for p in parts])
            stats = [mesh_stats(v, fc) for v, fc in parts]
            stats = [s for s in stats if s]
            if not stats:
                continue
            g = {"zmin": min(s["zmin"] for s in stats), "zmax": max(s["zmax"] for s in stats),
                 "volume_cf": sum(s["volume_cf"] for s in stats)}
            tt = types[elem_type[eid]]
            total_t_in = sum(l["thickness_in"] or 0 for l in tt["layers"])
            if kind in ("wall", "curtain_wall"):
                axis = wall_axis(e, unit_scale) if kind == "wall" else None
                if axis is None:
                    axis = long_axis_line(verts)
                    g["axis_from_mesh"] = True
                g["axis"] = axis
                g["length_lf"] = polyline_len(axis)
                g["height_ft"] = g["zmax"] - g["zmin"]
                g["gross_area_sf"] = g["length_lf"] * g["height_ft"]
                # volume / thickness = face area with door/window openings already cut out
                g["net_area_sf"] = g["volume_cf"] / (total_t_in / 12) if total_t_in and kind == "wall" else g["gross_area_sf"]
            else:
                tris = [np.vstack([s["tris_up"][i] for s in stats]) for i in range(3)]
                fp = footprint(tris)
                g["footprint"] = fp
                g["plan_area_sf"] = fp.area if fp is not None else 0.0
                g["top_area_sf"] = sum(s["top_area_sf"] for s in stats)
                if g["plan_area_sf"]:
                    g["thickness_from_geometry_in"] = 12 * g["volume_cf"] / g["plan_area_sf"]
            elem_geo[eid] = g

    # ---- layer thickness fallbacks and DB matching per type
    for tt in types.values():
        geo_t = [elem_geo[i].get("thickness_from_geometry_in") for i in tt["element_ids"] if i in elem_geo]
        geo_t = [x for x in geo_t if x]
        if len(tt["layers"]) == 1 and tt["layers"][0]["thickness_in"] is None and geo_t:
            tt["layers"][0]["thickness_in"] = round(float(np.median(geo_t)), 3)
            tt["layers"][0]["thickness_source"] = "geometry"
        if tt["kind"] == "curtain_wall" and not tt["layers"]:
            tt["layers"] = [{"material": "Curtain wall system (glass + framing)", "thickness_in": None}]
        if not tt["layers"]:
            tt["flags"].append("no_layers")
        if any(l["thickness_in"] is None for l in tt["layers"]):
            tt["flags"].append("layer_thickness_unknown")
        for l in tt["layers"]:
            named = inches_in_name(l["material"])
            if named and l["thickness_in"] and abs(named - l["thickness_in"]) > 1 / 16:
                l["name_thickness_in"] = named  # e.g. "Plywood - 3/4"" modelled at 5/8"
            if matcher:
                kind = "floor" if tt["kind"] in ("floor", "roof", "ceiling") else "wall"
                l["match"] = matcher.match(l["material"], l["thickness_in"], tt["name"], kind,
                                           single_layer=len(tt["layers"]) == 1).to_dict()
        if any("name_thickness_in" in l for l in tt["layers"]):
            tt["flags"].append("layer_name_thickness_mismatch")
        if matcher:
            if any(l["match"]["status"] == "placeholder" for l in tt["layers"]):
                tt["flags"].append("placeholder_material")
            sg = structural_guess(tt["layers"])
            tt["structural_guess"] = sg
            tt["group"] = sg["class"] if sg else "Finish / non-structural"
            if sg is None and tt["kind"] == "wall":
                tt["flags"].append("finish_only")
            known = [l["match"]["psf"] for l in tt["layers"] if l["match"]["psf"] is not None]
            tt["psf_guess"] = round(sum(known), 2) if known else None
            tt["layers_unresolved"] = sum(1 for l in tt["layers"] if l["match"]["status"] not in ("matched", "suggested"))
        tt["total_thickness_in"] = round(sum(l["thickness_in"] or 0 for l in tt["layers"]), 3)
        tt["layer_signature"] = [list(s) for s in signature(tt["layers"])]

    # ---- quantities per type
    for tt in types.values():
        gs = [elem_geo[i] for i in tt["element_ids"] if i in elem_geo]
        if tt["kind"] in ("wall", "curtain_wall"):
            L = sum(g["length_lf"] for g in gs)
            tt["qty"] = {"length_lf": round(L, 1),
                         "net_area_sf": round(sum(g["net_area_sf"] for g in gs), 1),
                         "gross_area_sf": round(sum(g["gross_area_sf"] for g in gs), 1),
                         "avg_height_ft": round(sum(g["gross_area_sf"] for g in gs) / L, 2) if L else None}
        else:
            tt["qty"] = {"plan_area_sf": round(sum(g["plan_area_sf"] for g in gs), 1),
                         "top_area_sf": round(sum(g["top_area_sf"] for g in gs), 1)}

    # ---- duplicates (identical layer stacks) and most-similar type
    dup = defaultdict(list)
    for tt in types.values():
        if tt["layers"]:
            dup[(tt["kind"], tuple(map(tuple, tt["layer_signature"])))].append(tt["id"])
    dup_groups = []
    for (kind, _), ids in dup.items():
        if len(ids) > 1:
            ids.sort(key=lambda i: -types[i]["instances"])
            gid = f"D{len(dup_groups) + 1}"
            dup_groups.append({"id": gid, "kind": kind, "type_ids": ids})
            for i in ids:
                types[i]["duplicate_group"] = gid
    for tt in types.values():
        best = None
        mats = [s[0] for s in tt["layer_signature"]]
        for other in types.values():
            if other["id"] == tt["id"] or other["kind"] != tt["kind"] or other.get("duplicate_group") and other.get("duplicate_group") == tt.get("duplicate_group"):
                continue
            omats = [s[0] for s in other["layer_signature"]]
            score = SequenceMatcher(None, mats, omats).ratio()
            dt = abs(tt["total_thickness_in"] - other["total_thickness_in"])
            score -= min(dt / max(tt["total_thickness_in"], 1), 0.5) * 0.3
            if best is None or score > best[0]:
                best = (score, other["id"])
        if best and best[0] > 0.5:
            tt["most_similar"] = {"type_id": best[1], "score": round(best[0], 2)}

    # ---- levels, plan geometry, composite floor assemblies (option b)
    levels = []
    plan = {}
    composites = {}
    level_of_elem = {}
    for e, kind in elements:
        s = storey_of(e)
        level_of_elem[e.id()] = s.id() if s else None

    if with_geometry:
        horiz = [(e, k) for e, k in elements if k in ("floor", "roof") and e.id() in elem_geo and elem_geo[e.id()].get("footprint")]
        ceilings = [(e, k) for e, k in elements if k == "ceiling" and e.id() in elem_geo and elem_geo[e.id()].get("footprint")]
        # hang each ceiling from the lowest floor/roof above it that it overlaps
        tree = shapely.STRtree([elem_geo[e.id()]["footprint"] for e, _ in horiz])
        for c, _ in ceilings:
            cg = elem_geo[c.id()]
            best = None
            for idx in tree.query(cg["footprint"]):
                h, _ = horiz[idx]
                hg = elem_geo[h.id()]
                gap = hg["zmin"] - cg["zmax"]
                if -0.5 <= gap <= MAX_CEILING_GAP_FT and hg["footprint"].intersects(cg["footprint"]):
                    if best is None or gap < best[0]:
                        best = (gap, h.id())
            cg["hung_from"] = best[1] if best else None
            if best:
                level_of_elem[c.id()] = level_of_elem[best[1]]

        by_level = defaultdict(lambda: {"areas": [], "walls": [], "pieces": []})
        for e, kind in elements:
            g = elem_geo.get(e.id())
            lid = level_of_elem.get(e.id())
            if g is None or lid is None:
                continue
            L = by_level[lid]
            if kind in ("wall", "curtain_wall"):
                L["walls"].append({"element_id": e.id(), "type_id": elem_type[e.id()],
                                   "points": [[round(x, 2), round(y, 2)] for x, y in g["axis"]],
                                   "length_lf": round(g["length_lf"], 2), "height_ft": round(g["height_ft"], 2),
                                   "net_area_sf": round(g["net_area_sf"], 1), "base_z_ft": round(g["zmin"], 2)})
            elif g.get("footprint") is not None:
                if kind == "ceiling" and not g.get("hung_from"):
                    pass  # ceiling with nothing above it: still drawn, its own assembly
                L["pieces"].append((e.id(), kind, g))

        for s in storeys:
            L = by_level.get(s.id())
            if not L or (not L["walls"] and not L["pieces"]):
                continue
            zones = composite_zones(L["pieces"], elem_type, types)
            for z in zones:
                cid = z["composite_id"]
                if cid not in composites:
                    composites[cid] = {"id": cid, "type_ids": z["type_ids"], "name": " + ".join(types[t]["name"] for t in z["type_ids"]),
                                       "kinds": [types[t]["kind"] for t in z["type_ids"]], "plan_area_sf": 0.0, "levels": []}
                composites[cid]["plan_area_sf"] += z["area_sf"]
                if s.id() not in composites[cid]["levels"]:
                    composites[cid]["levels"].append(s.id())
            plan[s.id()] = {"zones": [{k: v for k, v in z.items() if k != "geom"} for z in zones],
                            "walls": L["walls"],
                            "elements": [{"element_id": eid, "type_id": elem_type[eid], "kind": k,
                                          "polygons": poly_coords(g["footprint"]), "plan_area_sf": round(g["plan_area_sf"], 1),
                                          "z_top_ft": round(g["zmax"], 2), "z_bottom_ft": round(g["zmin"], 2),
                                          "hung_from": g.get("hung_from")} for eid, k, g in L["pieces"]]}
            levels.append({"id": s.id(), "name": s.Name, "elevation_ft": round(storey_elev[s.id()], 3)})
        for c in composites.values():
            c["plan_area_sf"] = round(c["plan_area_sf"], 1)
            if matcher:
                psfs = [types[t].get("psf_guess") for t in c["type_ids"]]
                c["psf_guess"] = round(sum(p for p in psfs if p), 2)
    else:
        for s in storeys:
            levels.append({"id": s.id(), "name": s.Name, "elevation_ft": round(storey_elev[s.id()], 3)})

    # datum-only storeys (grade planes, T.O. plate...) that carry almost nothing: the UI can hide them
    sizes = {lv["id"]: sum(z["area_sf"] for z in plan.get(lv["id"], {}).get("zones", [])) for lv in levels}
    biggest = max(sizes.values(), default=0)
    for lv in levels:
        lv["floor_area_sf"] = round(sizes.get(lv["id"], 0))
        lv["minor"] = bool(biggest) and sizes.get(lv["id"], 0) < 0.02 * biggest

    level_groups = group_typical_levels(levels, plan, types)

    for tt in types.values():
        tt["levels"] = sorted({level_of_elem.get(i) for i in tt["element_ids"]} - {None})

    out = {
        "schema_version": 1,
        "source": {"file": Path(path).name, "ifc_schema": f.schema,
                   "description": list(f.header.file_description.description),
                   "originating_system": f.header.file_name.originating_system,
                   "length_unit_m": unit_scale, "units": "ft / in / sf / lf"},
        "levels": levels, "level_groups": level_groups,
        "types": sorted(types.values(), key=lambda t: (t["kind"], -t["instances"])),
        "duplicate_groups": dup_groups,
        "composites": sorted(composites.values(), key=lambda c: -c["plan_area_sf"]),
        "plan": {str(k): v for k, v in plan.items()},
        "excluded": dict(excluded),
        "stats": {"elements": len(elements), "types": len(types), "seconds": round(time.time() - t0, 1)},
    }
    return out


def composite_zones(pieces, elem_type, types):
    """Planar overlay of all floor/roof/ceiling footprints on a level.

    Each face of the overlay is covered by some set of elements. Elements that
    touch vertically (a finish floor on a slab, a ceiling hung from it) form one
    stack; stacks of the same *types* are one composite assembly (e.g. carpet
    floor + 18" truss floor + GWB ceiling below), types ordered top to bottom.
    Elements that overlap in plan but are vertically apart (a sloped roof over a
    flat roof) are separate stacks, so their zones overlap on the plan.
    """
    if not pieces:
        return []
    geoms = [g["footprint"] for _, _, g in pieces]
    lines = unary_union([gm.boundary for gm in geoms])
    faces = list(polygonize(lines))
    tree = shapely.STRtree(geoms)
    groups = defaultdict(list)
    for face in faces:
        if face.area < 0.5:
            continue
        pt = face.representative_point()
        hits = [i for i in tree.query(pt) if geoms[i].contains(pt)]
        if not hits:
            continue
        hits.sort(key=lambda i: -pieces[i][2]["zmax"])
        stacks = []
        for i in hits:
            eid, _, g = pieces[i]
            s = stacks[-1] if stacks else None
            kind = pieces[i][1]
            touches = s is not None and (
                g["zmax"] >= s["bottom"] - STACK_TOL_FT
                or (kind == "ceiling" and 0 <= s["bottom"] - g["zmax"] <= MAX_CEILING_GAP_FT))  # ceiling hangs from the stack above
            if not touches:
                s = {"eids": set(), "tids": [], "bottom": g["zmin"]}
                stacks.append(s)
            s["eids"].add(eid)
            s["bottom"] = min(s["bottom"], g["zmin"])
            if elem_type[eid] not in s["tids"]:
                s["tids"].append(elem_type[eid])
        for s in stacks:
            groups[tuple(s["tids"])].append(face)
    zones = []
    for tids, fs in groups.items():
        geom = unary_union(fs).simplify(SIMPLIFY_FT)
        mp = geom if isinstance(geom, MultiPolygon) else MultiPolygon([geom]) if isinstance(geom, Polygon) else None
        if mp is None or mp.area < 1:
            continue
        cid = "C" + hashlib.md5("|".join(tids).encode()).hexdigest()[:8] if len(tids) > 1 else tids[0]
        zones.append({"composite_id": cid, "type_ids": list(tids), "area_sf": round(mp.area, 1),
                      "polygons": poly_coords(mp), "label_xy": [round(c, 2) for c in mp.representative_point().coords[0]]})
    return zones


def group_typical_levels(levels, plan, types, threshold=0.95):
    """Group consecutive levels whose assembly quantities match within ~5%."""
    def sig(lid):
        p = plan.get(str(lid)) or plan.get(lid)
        q = Counter()
        if not p:
            return q
        for z in p["zones"]:
            q["A:" + z["composite_id"]] += z["area_sf"]
        for w in p["walls"]:
            q["W:" + w["type_id"]] += w["length_lf"]
        return q

    def sim(a, b):
        keys = set(a) | set(b)
        if not keys:
            return 0
        return sum(min(a[k], b[k]) for k in keys) / max(sum(max(a[k], b[k]) for k in keys), 1e-9)

    groups = []
    for lv in levels:
        s = sig(lv["id"])
        if groups and sim(groups[-1]["_sig"], s) >= threshold:
            groups[-1]["level_ids"].append(lv["id"])
        else:
            groups.append({"level_ids": [lv["id"]], "_sig": s})
    out = []
    names = {lv["id"]: lv["name"] for lv in levels}
    for i, g in enumerate(groups):
        ids = g["level_ids"]
        out.append({"id": f"G{i + 1}", "level_ids": ids, "typical": len(ids) > 1,
                    "name": names[ids[0]] if len(ids) == 1 else f"{names[ids[0]]} - {names[ids[-1]]} (typical x{len(ids)})"})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ifc")
    ap.add_argument("--db", help="dead load database .xlsx")
    ap.add_argument("-o", "--out")
    ap.add_argument("--no-geometry", action="store_true", help="types and layers only (fast)")
    a = ap.parse_args()
    data = extract(a.ifc, a.db, not a.no_geometry)
    out = a.out or str(Path(a.ifc).with_suffix(".dl.json"))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(data, indent=1, default=float), encoding="utf-8")
    log(f"wrote {out}  ({Path(out).stat().st_size / 1e6:.1f} MB, {data['stats']})")


if __name__ == "__main__":
    main()
