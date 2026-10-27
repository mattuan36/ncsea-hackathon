"""Throwaway review UI for the extracted JSON. Not the product UI - it exists to
check that the IFC data is enough to drive the real one.

    set DL_DB_XLSX=path/to/Dead_Load_Weights.xlsx
    streamlit run review_app.py
"""
import json
import os
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from dl_db import load_db, SUPPLEMENTAL
from matcher import Matcher

HERE = Path(__file__).parent
DEFAULT_DB = os.environ.get("DL_DB_XLSX", "")
STATUS_ICON = {"matched": "🟢", "suggested": "🟡", "ambiguous": "🟠", "no_db_row": "🔴", "placeholder": "⚪", "unknown": "⚫"}
PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#db2777", "#a16207", "#65a30d",
           "#dc2626", "#0284c7", "#7c3aed", "#b45309", "#059669", "#be185d", "#4d7c0f", "#475569"]
ALLOWANCES = {"MEP": 5.0, "Concrete ponding": 5.0, "Future finishes": 10.0}

st.set_page_config(page_title="Gravity DL - data review", layout="wide")


@st.cache_data
def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


@st.cache_resource
def load_matcher(path):
    return Matcher(load_db(path))


# ---------------------------------------------------------------- sidebar
files = sorted((HERE / "out").glob("*.json"))
files = [f for f in files if not f.name.endswith("_nogeo.json")] or files
src = st.sidebar.selectbox("Extracted model", files, format_func=lambda p: p.name)
db_path = st.sidebar.text_input("Dead load database", str(DEFAULT_DB))
if not src:
    st.info("Run `python ifc_extract.py model.ifc --db db.xlsx -o out/model.json` first.")
    st.stop()
if not db_path or not Path(db_path).exists():
    st.info("Point the sidebar at the dead load database .xlsx (or set DL_DB_XLSX).")
    st.stop()
data = load_json(str(src))
matcher = load_matcher(db_path)
rows = {r.id: r for r in matcher.rows}
types = {t["id"]: t for t in data["types"]}
st.sidebar.caption(f'{data["source"]["file"]}\n\n{data["stats"]["elements"]} elements, {len(types)} types, '
                   f'{len(data["composites"])} floor assemblies')
if "choices" not in st.session_state:
    st.session_state.choices = {}  # (type_id, layer_idx) -> row id / override

tab_guide, tab_types, tab_walk, tab_plan, tab_match = st.tabs(
    ["1 · Export guide", "2 · Types in model", "3 · Assembly walk-through", "4 · Plan", "Match report"])

# ---------------------------------------------------------------- 1. guide
with tab_guide:
    st.markdown("""
#### Export the architectural model to IFC
1. Open the architect's model in Revit and open a **3D view**.
2. In Visibility/Graphics, show only **Walls, Floors, Roofs, Ceilings, Curtain Panels/Systems** (smaller file, faster upload).
3. **File → Export → IFC**. Setup: **IFC 2x3 Coordination View 2.0** (defaults are fine).
4. Modify Setup → General: tick **Export only elements visible in view**.
5. Export, then upload the `.ifc` here.
""")
    st.json(data["source"], expanded=False)
    st.write("Excluded from the takeoff:", data["excluded"])

# ---------------------------------------------------------------- 2. types
with tab_types:
    kinds = st.multiselect("Kinds", sorted({t["kind"] for t in types.values()}), default=None)
    recs = []
    for t in data["types"]:
        if kinds and t["kind"] not in kinds:
            continue
        q = t.get("qty", {})
        recs.append({"kind": t["kind"], "group (struct. guess)": t.get("group"), "name": t["name"], "instances": t["instances"],
                     "SF / LF": q.get("plan_area_sf") or q.get("length_lf"), "avg ht ft": q.get("avg_height_ft"),
                     "layers": len(t["layers"]), "unresolved": t.get("layers_unresolved"), "psf (known layers)": t.get("psf_guess"),
                     "duplicate grp": t.get("duplicate_group"), "most similar": types.get((t.get("most_similar") or {}).get("type_id"), {}).get("name"),
                     "flags": ", ".join(t["flags"])})
    st.dataframe(pd.DataFrame(recs), width="stretch", height=650)

# ---------------------------------------------------------------- 3. walk-through
def section_figure(layers, psfs):
    fig = go.Figure()
    y = 0.0
    for i, (l, p) in enumerate(zip(layers, psfs)):
        h = max(l["thickness_in"] or 0.25, 0.25)
        fig.add_shape(type="rect", x0=0, x1=10, y0=-y - h, y1=-y, fillcolor=PALETTE[i % len(PALETTE)], opacity=0.55, line=dict(width=1))
        fig.add_annotation(x=10.3, y=-y - h / 2, xanchor="left", showarrow=False,
                           text=f'{l["material"][:45]} · {(l["thickness_in"] or 0):.3g}" · {p if p is not None else "?"} psf')
        y += h
    fig.update_xaxes(visible=False, range=[0, 30])
    fig.update_yaxes(visible=False, range=[-y - 0.5, 0.5])
    fig.update_layout(height=max(160, 28 * len(layers) + 60), margin=dict(l=0, r=0, t=10, b=10), showlegend=False)
    return fig


with tab_walk:
    order = sorted([t for t in data["types"] if t["kind"] != "curtain_wall" or True],
                   key=lambda t: (t["kind"], t.get("group") or "", -t["instances"]))
    c1, c2 = st.columns([1, 3])
    with c1:
        kind = st.radio("Kind", ["wall", "floor", "roof", "ceiling", "curtain_wall"], horizontal=False)
        pool = [t for t in order if t["kind"] == kind]
        groups = sorted({t.get("group") for t in pool})
        grp = st.selectbox("Structural group", groups)
        pick = st.radio("Type", [t["id"] for t in pool if t.get("group") == grp],
                        format_func=lambda i: f'{types[i]["name"][:50]} ({types[i]["instances"]})')
    t = types[pick]
    with c2:
        st.subheader(t["name"])
        sg = t.get("structural_guess")
        st.caption(f'Structural material guess: **{sg["material"] if sg else "none (finish only?)"}** — {sg["reason"] if sg else ""} · '
                   f'flags: {", ".join(t["flags"]) or "none"}')
        if t.get("duplicate_group"):
            dups = next(g for g in data["duplicate_groups"] if g["id"] == t["duplicate_group"])["type_ids"]
            st.info("Identical layers to: " + "; ".join(types[d]["name"] for d in dups if d != t["id"]))
        if t.get("most_similar"):
            st.caption(f'Most similar: {types[t["most_similar"]["type_id"]]["name"]} (score {t["most_similar"]["score"]})')
        all_ids = [r.id for r in matcher.rows]
        psfs = []
        for i, l in enumerate(t["layers"]):
            m = l.get("match") or {}
            key = (t["id"], i)
            cands = m.get("candidates") or []
            options = ["—"] + cands + [x for x in all_ids if x not in cands]
            default = st.session_state.choices.get(key, m.get("row_id") or "—")
            cc = st.columns([3, 4, 1.2, 1.2])
            cc[0].markdown(f'{STATUS_ICON.get(m.get("status"), "")} **{l["material"]}**  \n'
                           f'{(l["thickness_in"] or 0):.3g}" · _{m.get("material_class") or "?"}_ · {m.get("status")}  \n'
                           f'<small>{m.get("note") or ""}</small>', unsafe_allow_html=True)
            rid = cc[1].selectbox("DB row", options, index=options.index(default) if default in options else 0,
                                  format_func=lambda x: "— pick —" if x == "—" else f"{x}: {rows[x].label()}", key=f"sel{key}",
                                  label_visibility="collapsed")
            st.session_state.choices[key] = rid
            calc = rows[rid].psf_at(l["thickness_in"]) if rid != "—" else None
            ov = cc[2].number_input("psf", value=float(calc) if calc is not None else 0.0, key=f"ov{key}{rid}",
                                    label_visibility="collapsed", step=0.1)
            cc[3].write(f"calc {calc if calc is not None else '?'}")
            psfs.append(round(ov, 2))
        st.markdown("**Load allowances**")
        ac = st.columns(3)
        allow = 0.0
        for j, (name, dflt) in enumerate(ALLOWANCES.items()):
            if t["kind"] in ("floor", "roof", "ceiling"):
                allow += ac[j].number_input(name, value=0.0, step=0.5, key=f"al{t['id']}{name}", help=f"typical {dflt} psf")
        st.metric("Assembly dead load", f"{sum(psfs) + allow:.1f} psf", help="layers + allowances")
        st.plotly_chart(section_figure(t["layers"], psfs), width="stretch")
        st.json({"qty": t.get("qty"), "levels": t.get("levels")}, expanded=False)

# ---------------------------------------------------------------- 4. plan
def ring_xy(polys):
    xs, ys = [], []
    for p in polys:
        for ring in [p["outer"]] + p["holes"]:
            xs += [c[0] for c in ring] + [None]
            ys += [c[1] for c in ring] + [None]
    return xs, ys


with tab_plan:
    minor = {lv["id"] for lv in data["levels"] if lv.get("minor")}
    groups = data["level_groups"]
    if not st.checkbox("show minor datum levels (grade planes, T.O. plate...)", value=False):
        groups = [g for g in groups if not set(g["level_ids"]) <= minor] or groups
    g = st.selectbox("Level", groups, format_func=lambda g: g["name"])
    lid = str(g["level_ids"][0])
    p = data["plan"].get(lid)
    if not p:
        st.warning("No plan geometry on this level")
        st.stop()
    comps = {c["id"]: c for c in data["composites"]}
    fig = go.Figure()
    zone_rows, wall_rows = [], []
    by_comp = {}
    for z in p["zones"]:
        by_comp.setdefault(z["composite_id"], []).append(z)
    for k, (cid, zs) in enumerate(sorted(by_comp.items(), key=lambda kv: -sum(z["area_sf"] for z in kv[1]))):
        name = comps[cid]["name"] if cid in comps else types[cid]["name"]
        xs, ys = ring_xy([pp for z in zs for pp in z["polygons"]])
        area = sum(z["area_sf"] for z in zs)
        fig.add_trace(go.Scatter(x=xs, y=ys, fill="toself", mode="lines", line=dict(width=1, color=PALETTE[k % 16]),
                                 fillcolor=PALETTE[k % 16], opacity=0.35, name=f"{name[:60]} — {area:,.0f} sf",
                                 legendgroup=cid, hoverinfo="name"))
        zone_rows.append({"assembly": name, "SF": round(area), "psf (known)": comps.get(cid, {}).get("psf_guess")})
    by_wt = {}
    for w in p["walls"]:
        by_wt.setdefault(w["type_id"], []).append(w)
    for k, (tid, ws) in enumerate(sorted(by_wt.items(), key=lambda kv: -sum(w["length_lf"] for w in kv[1]))):
        xs, ys = [], []
        for w in ws:
            xs += [c[0] for c in w["points"]] + [None]
            ys += [c[1] for c in w["points"]] + [None]
        L = sum(w["length_lf"] for w in ws)
        fig.add_trace(go.Scatter(x=xs, y=ys, mode="lines", line=dict(width=4, color=PALETTE[(k + 5) % 16]),
                                 name=f'{types[tid]["name"][:60]} — {L:,.0f} lf', legendgroup=tid, hoverinfo="name"))
        wall_rows.append({"wall type": types[tid]["name"], "LF": round(L), "avg ht": round(sum(w["height_ft"] * w["length_lf"] for w in ws) / L, 1) if L else None,
                          "net SF": round(sum(w["net_area_sf"] for w in ws)), "psf (known)": types[tid].get("psf_guess")})
    fig.update_yaxes(scaleanchor="x", scaleratio=1)
    fig.update_layout(height=900, margin=dict(l=0, r=0, t=30, b=0),
                      legend=dict(font=dict(size=10), orientation="h", yanchor="top", y=-0.02),
                      title="click a legend item to hide it, double-click to isolate it")
    c1, c2 = st.columns([3, 1.3])
    c1.plotly_chart(fig, width="stretch")
    c2.dataframe(pd.DataFrame(zone_rows), width="stretch", hide_index=True)
    c2.dataframe(pd.DataFrame(wall_rows), width="stretch", hide_index=True)

# ---------------------------------------------------------------- match report
with tab_match:
    recs = []
    for t in data["types"]:
        for l in t["layers"]:
            m = l.get("match") or {}
            recs.append({"status": m.get("status"), "material": l["material"], "t (in)": l["thickness_in"], "class": m.get("material_class"),
                         "row": m.get("row_id"), "psf": m.get("psf"), "note": m.get("note"), "type": t["name"], "instances": t["instances"]})
    df = pd.DataFrame(recs)
    st.write(df.groupby("status")["instances"].sum().sort_values(ascending=False))
    st.dataframe(df.sort_values("instances", ascending=False), width="stretch", height=650)
