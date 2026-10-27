"""Best-guess matching of Revit layer materials to dead load database rows.

Each layer is matched on its Revit *material name* (trusted) plus its layer
thickness. The assembly's type name is only used for modifiers the material
name rarely carries (grout spacing, CMU unit weight, deck gauge, stud spacing,
lightweight concrete) - never to decide what the material is.

Every result has a status the UI can colour:
    matched     one DB row, confident (keyword + thickness agree)
    suggested   one DB row picked, but verify (nearest thickness, source tie-break)
    ambiguous   material recognised, several rows fit - candidates listed, no pick
    no_db_row   material recognised, but the database has no row for it
    placeholder Revit default/unnamed material - the user has to define it
    unknown     nothing matched

`candidates` is the pre-filter for the UI dropdown in every status except
unknown/placeholder (the dropdown should still let the user search the whole DB).

The RULES table below is the part to tune: first rule whose pattern matches wins.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from dl_db import DbRow, SUPPLEMENTAL

TOL_EXACT_IN = 1 / 32       # layer thickness vs row dimension: counts as exact
TOL_NEAR = 0.15             # within 15% -> nearest-thickness suggestion
NOMINAL_PICKERS = {"lumber", "cmu", "brick"}  # pickers that resolve thickness themselves


# ---------------------------------------------------------------- normalising

_PREFIXES = [
    r"^\s*\d{2}\s*-\s*",                           # CSI division: "09 - "
    r"^(finishes|wood p&c|thermal & mp|concrete|masonry|metals?|openings|revit default)\s*-\s*",
    r"^_+\d*_*",                                    # "_0000_", "_"
    r"^[a-z]{1,4}-\d{1,3}[a-z]?\s*[_\-]\s*",        # material tags: "BR-01_", "T-02 - ", "CONC-02_"
    r"^arcat\s*-\s*(thermal|masonry)?\s*-?\s*",     # ARCAT library prefixes
    r"^(structure|finish|insulation / thermal barriers)\s*-\s*",
]


def normalize(name: str) -> str:
    s = (name or "").strip().lower()
    for _ in range(3):  # prefixes can stack: "09 - Finishes - Gypsum..."
        before = s
        for p in _PREFIXES:
            s = re.sub(p, "", s)
        if s == before:
            break
    s = s.replace("&", " and ")
    return re.sub(r"\s+", " ", s).strip()


_FRACTION = re.compile(r'(\d+)?[\s-]*(\d+)/(\d+)\s*"|(\d+(?:\.\d+)?)\s*"')


_SIZE_PAIR = re.compile(r'\d+(\.\d+)?\s*"?\s*[x×]\s*\d+(\.\d+)?\s*"?', re.I)


def inches_in_name(name: str) -> float | None:
    """First dimension written in a material name: '5/8"' -> 0.625, '3 5/8"' -> 3.625.
    Tile/panel sizes like 24" x 48" are not thicknesses and are skipped."""
    m = _FRACTION.search(_SIZE_PAIR.sub(" ", name or ""))
    if not m:
        return None
    if m.group(4):
        return float(m.group(4))
    whole = float(m.group(1)) if m.group(1) else 0.0
    return whole + float(m.group(2)) / float(m.group(3))


def gauge(text: str) -> int | None:
    m = re.search(r"\b(\d{2})\s*-?\s*(ga|gauge|gage)\b", text)
    return int(m.group(1)) if m else None


def spacing_oc(text: str) -> int | None:
    m = re.search(r'@\s*(12|16|24)\s*("|in\.?|o\.?c\.?)?|\b(12|16|24)\s*"?\s*o\.?c\.?', text)
    return int(m.group(1) or m.group(3)) if m else None


# ---------------------------------------------------------------- rules

@dataclass
class Rule:
    name: str               # material class shown to the user ("Gypsum board")
    pattern: str            # regex on the normalised material name
    db: str | None = None   # regex on DB `material` column selecting candidate rows
    use: str | None = None  # optional regex on DB `use` column
    exclude: str | None = None
    status: str | None = None   # force a status: no_db_row / placeholder / zero
    note: str = ""
    picker: str | None = None   # special row-picking logic (cmu, brick, stud, deck, ...)
    structural: str | None = None  # structural class if this layer can be the structure


RULES: list[Rule] = [
    # placeholders: Revit's default materials carry no information
    Rule("Placeholder", r"^(<unnamed>|default|default (wall|floor|roof|material|new material|opaque material|mass.*)|generic.*|-|by category|\d+)$|^default$",
         status="placeholder", note="Revit default material - define this layer"),

    # zero-weight layers
    Rule("Air space", r"\bair\b(?!\s*(barrier|/))|\bcavity\b|air ?gap|misc\.? air layers", db=r"^air space$", status="zero"),
    Rule("Membrane / barrier", r"vapou?r|air barrier|\bwrb\b|weather barrier|house ?wrap|damp ?proof|water ?proof|drainage (board|mat|plane)|felt|underlayment|building paper|tyvek",
         db=r"^vapor/air barrier$", status="zero", exclude=r"roof"),
    Rule("Paint / sealer", r"\bpaint\b|coating|sealer|sealed concrete|\bstain\b|^pt-\d", db=r"^paint / coating$", status="zero"),

    # framing first: "Wood Joist/Rafter Layer, Batt Insulation" is framing, not insulation
    Rule("Wood I-joist / truss", r"(truss|tji|i-?joist|open web|floor truss)", status="no_db_row",
         note="engineered joists/trusses: no DB row (DB has sawn 2x joist floors only)", structural="Wood joist/truss"),
    Rule("Wood joist / rafter", r"(joist|rafter)", db=r"^(wood joist|douglas fir)", picker="lumber", structural="Wood joist/truss"),
    Rule("Wood stud", r"wood.*stud|stud.*wood|\b2x\d+\b.*stud|dimensional lumber|\blumber\b|wood framing",
         db=r"^douglas fir", picker="lumber", structural="Wood stud"),
    Rule("Furring / resilient channel", r"furring|resilient|\brc-?\d|hat channel|rsic|z-?girt|sound clip|channel", status="no_db_row",
         note="furring / RC channel: no DB row (typically < 0.5 psf)"),
    Rule("Cold-formed steel stud", r"(metal|steel|cfs|mtl).*stud|stud layer|\bstud\b", status="no_db_row",
         note="CFS stud layer: DB only has whole-wall CFS rows (10/15/25 psf)", structural="Metal stud"),

    # mass timber
    Rule("CLT / mass timber", r"\bclt\b|cross[- ]?laminated|glulam|mass timber|\bnlt\b|\bdlt\b|\bmt slab\b", status="no_db_row",
         note="mass timber: no DB row (~35 pcf -> ~2.9 psf/in)", structural="Mass timber"),

    # gypsum products (order: topping, sheathing, board)
    Rule("Gypsum topping", r"gyp(sum)?[- ]?crete|gypsum (concrete|topping|underlayment)|levelrock|maxxon|poured gyp", db=r"^gyp-crete$"),
    Rule("Gypsum sheathing", r"dens ?glass|glass[- ]?mat gyp|gyp(sum)? sheathing|exterior gyp", db=r"^(gypsum|gypsum board)$"),
    Rule("Gypsum board", r"\bgyp(sum)?\b|\bgwb\b|gyp\.? ?b(oar)?d|wall ?board|drywall|sheetrock|shaft ?liner|core ?board",
         db=r"^gypsum board$", exclude=r"plaster|crete|concrete"),
    Rule("Plaster / stucco", r"plaster|stucco", db=r"^(plaster|cement plaster|gypsum plaster)$"),
    Rule("EIFS", r"\beifs\b|exterior insulation", status="no_db_row", note="EIFS: no DB row (typically 1-3 psf)"),

    # masonry
    Rule("CMU", r"\bcmu\b|concrete (masonry|block)|masonry unit|\bblock\b", db=r"^cmu", picker="cmu", structural="CMU"),
    Rule("Clay brick", r"\bbrick\b", db=r"^clay brick$", picker="brick", structural="Masonry"),
    Rule("Pavers", r"paver|pedestal", db=r"^pedestals and pavers$"),
    Rule("Slate", r"\bslate\b", db=r"^slate$"),
    Rule("Stone", r"\bstone\b|granite|limestone|marble|quartzite|travertine|cast stone", status="no_db_row",
         note="stone veneer/finish: no DB row"),
    Rule("Mortar / setting bed", r"mortar|setting bed|thinset|grout", status="no_db_row",
         note="mortar bed: DB tile rows include mortar - consider merging with the tile layer"),

    # concrete
    Rule("Cement board", r"cement(itious)? (b(oar)?d|backer)|backer ?board|durock|hardiebacker", status="no_db_row",
         exclude=r"panel|siding|trim", note="cement backer board: no DB row (~3 psf at 1/2\")"),
    Rule("Fiber cement siding", r"fiber ?cement|hardie|cement b(oar)?d\.? (panel|siding|trim)|board and batten", db=r"^fiber cement siding$"),
    Rule("Concrete", r"\bconc(rete)?\b|cast[- ]in[- ]place|\bcip\b|precast|shotcrete|formliner",
         db=r"^(normal weight concrete|lightweight concrete|stone concrete)$", picker="concrete", structural="Concrete"),
    Rule("Gravel / fill", r"gravel|crushed|aggregate|\bfill\b|\bsoil\b|\bearth\b", db=r"^sand$", status="no_db_row",
         note="granular fill: no DB row (sand is 8 psf/in)"),

    # wood sheathing / decking / finishes
    Rule("Plywood", r"plywood|\bply\b", db=r"^plywood$"),
    Rule("OSB", r"\bosb\b|oriented strand", db=r"^osb$"),
    Rule("Wood decking", r"(wood|timber|t ?and ?g|tongue).*(deck|decking)|\b2x (wood )?decking", db=r"(wood decking|2x wood decking)"),
    Rule("Composite decking", r"trex|composite deck", status="no_db_row", note="composite decking: no DB row"),
    Rule("Wood flooring", r"hard ?wood|wood floor|parquet|oak floor|engineered wood", db=r"^hardwood$"),
    Rule("Lap siding", r"lap siding|(vinyl|fiber|composite) siding", db=r"^(fiber cement siding|vinyl siding)$"),
    Rule("Wood sheathing / boards", r"sheathing|\bboards?\b|cedar|t ?and ?g|wood siding|\bwood\b|walnut|maple|birch|cherry|hemlock",
         db=r"^(wood|wood boards)$", exclude=r"metal|composite"),

    # insulation
    Rule("Rigid foam insulation", r"\beps\b|\bxps\b|polystyrene|polyiso|styrofoam|foam board|\brigid\b", db=r"^polystyrene or polyisocyanurate foam$"),
    Rule("Mineral wool", r"mineral wool|rock ?wool|stone wool", status="no_db_row", note="mineral wool: no DB row (~0.3-0.7 psf/in)"),
    Rule("Batt insulation", r"\bbatt\b|blanket|fiberglass|fibreglass|loose ?fill|blown|cellulose|sound attenuat|\bsafb\b", db=r"^loose fill, blown-in, batt$"),
    Rule("Spray foam", r"spray(ed)? foam|\bspf\b", db=r"spray foam", picker="sprayfoam"),
    Rule("Acoustic mat", r"acoustic(al)? mat|sound mat|underlay", status="no_db_row", note="acoustic mat: no DB row"),
    Rule("Insulation", r"insulation|thermal", db=r"^(polystyrene or polyisocyanurate foam|loose fill, blown-in, batt|fibrous glass|cellular glass|perlite|fiberboard|rigid insulation|styrofoam)$",
         use=r"insulation"),

    # roofing
    Rule("Single-ply membrane", r"\btpo\b|\bepdm\b|\bpvc\b|single[- ]?ply|thermoplastic", db=r"^single-ply membrane$"),
    Rule("Bituminous membrane", r"bitum|mod(ified)? bit|\bsbs\b|built[- ]?up|\bbur\b", db=r"^bituminous membrane$"),
    Rule("Asphalt shingles", r"shingle", db=r"^asphalt shingles$"),
    Rule("Standing seam roof", r"standing seam|metal roof", db=r"^standing seam metal$", picker="panel_only"),
    Rule("Clay / concrete roof tile", r"clay tile|terra ?cotta|spanish tile|roof tile|concrete tile", db=r"^(clay tile|concrete tile)$"),
    Rule("Ballast", r"ballast|river rock", db=r"^ballast rock$"),

    # deck, ceilings, finishes
    Rule("Metal deck", r"(metal|steel|composite|form|roof)\s*-?\s*deck|versa ?dek|\bdeck\b", db=r"^metal deck$", picker="deck",
         exclude=r"wood|trex|clt|timber", structural="Steel deck"),
    Rule("Corrugated metal", r"corrugated", db=r"^corrugated galvanized steel$", picker="deck"),
    Rule("Acoustic ceiling tile", r"acoustic(al)? (ceiling )?tile|\bact\b|ceiling tile|lay[- ]?in", db=r"^(acoustical fiber tile|acoustical fiberboard)$"),
    Rule("Carpet", r"carpet|\bcpt\b", db=r"^carpet$"),
    Rule("Resilient flooring", r"\blvt\b|\bvct\b|\blvp\b|vinyl (tile|plank|floor)|sheet vinyl|linoleum|resilient|rubber (floor|tile)",
         db=r"^linoleum or soft tile$"),
    Rule("Epoxy / coating", r"epoxy|urethane coat|traffic coat", db=r"^paint / coating$", status="zero"),
    Rule("Terrazzo", r"terrazzo", db=r"^terrazzo$"),
    Rule("Ceramic / porcelain tile", r"\btile\b|ceramic|porcelain|porcelin|quarry|mosaic|hexagon|subway",
         db=r"^(ceramic tile|ceramic or quarry tile)$", exclude=r"roof|ceiling"),
    Rule("Vinyl siding", r"vinyl siding", db=r"^vinyl siding$"),

    # glazing, metals
    Rule("Glazing", r"\bglass\b|glazing|vision|spandrel|\bigu?\b|insulated glass|low[- ]?e",
         db=r"^(glazing|glass, frame, and sash)$", exclude=r"glass mat|fiberglass|cellular glass|glass fiber", structural="Glass"),
    Rule("Metal panel / ACM", r"\bacm\b|aluminum composite|metal panel|metal siding|flashing|composite panel|\bimp\b|\bmapes\b|metal fascia|anodized|alumin(i)?um",
         status="no_db_row", note="metal/composite panel: no DB row (typically 2-4 psf)"),
    Rule("Structural steel", r"\bsteel\b|astm a\d+", status="no_db_row", note="steel: weight by member, not a layer", structural="Steel"),
    Rule("Turf / planting", r"turf|grass|planting|growing medium|green roof", status="no_db_row", note="vegetated/turf: no DB row"),
]

_COMPILED = [(r, re.compile(r.pattern), re.compile(r.exclude) if r.exclude else None) for r in RULES]


# ---------------------------------------------------------------- result

@dataclass
class Match:
    status: str
    material_class: str | None = None
    row_id: str | None = None
    psf: float | None = None
    candidates: list[str] = field(default_factory=list)
    note: str = ""
    structural: str | None = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class Matcher:
    def __init__(self, rows: list[DbRow]):
        self.rows = rows + SUPPLEMENTAL
        self.by_id = {r.id: r for r in self.rows}

    def _rows(self, mat_re: str, use_re: str | None = None) -> list[DbRow]:
        m = re.compile(mat_re, re.I)
        u = re.compile(use_re, re.I) if use_re else None
        return [r for r in self.rows if m.search(r.material) and (u is None or u.search(r.use))]

    # -- main entry
    def match(self, material: str, t_in: float | None, type_name: str = "", kind: str = "",
              single_layer: bool = False) -> Match:
        """single_layer: the assembly has only this one layer, so when the material
        name says nothing ("T-02 - Rectangular - Stacked") the type name ("Wall
        Tile") may stand in for it. Never used for multi-layer assemblies."""
        norm = normalize(material)
        context = f"{norm} {normalize(type_name)}"
        m = self._first_rule(norm, context, t_in, kind)
        named = inches_in_name(material)
        if m.status == "matched" and m.psf and named and t_in and abs(named - t_in) > 1 / 16:
            m.status = "suggested"  # "Plywood - 3/4"" modelled at 5/8": the model and the name disagree
            m.note = "; ".join(x for x in (m.note, f'name says {named:g}", layer is {t_in:g}"') if x)
        if m.status == "unknown" and single_layer and type_name:
            tm = self._first_rule(normalize(type_name.split(":")[-1]), context, t_in, kind)
            if tm.status not in ("unknown", "placeholder"):
                if tm.status == "matched":
                    tm.status = "suggested"
                tm.note = ("guessed from type name; " + tm.note).strip("; ")
                return tm
        return m

    def _first_rule(self, norm: str, context: str, t_in, kind) -> Match:
        for rule, pat, exc in _COMPILED:
            if not pat.search(norm):
                continue
            if exc and exc.search(norm):
                continue
            return self._apply(rule, norm, context, t_in, kind)
        return Match("unknown", note="no rule matched")

    def _apply(self, rule: Rule, norm: str, ctx: str, t: float | None, kind: str) -> Match:
        base = dict(material_class=rule.name, structural=rule.structural)
        if rule.status == "placeholder":
            return Match("placeholder", note=rule.note, **base)
        cands = self._rows(rule.db, rule.use) if rule.db else []
        if rule.status == "zero":
            row = cands[0]
            return Match("matched", row_id=row.id, psf=0.0, candidates=[row.id], note="zero-weight layer", **base)
        if rule.status == "no_db_row":
            return Match("no_db_row", candidates=[c.id for c in cands], note=rule.note, **base)
        if not cands:
            return Match("no_db_row", note=f"no DB rows for '{rule.name}'", **base)

        if rule.picker:
            picked = getattr(self, f"_pick_{rule.picker}")(cands, norm, ctx, t, kind)
            if not picked:
                return Match("no_db_row", candidates=[c.id for c in cands],
                             note=f"no DB row for this size ({t:g}\")" if t else "no DB row fits", **base)
            if isinstance(picked, tuple):  # picker downgraded its own confidence
                picked, note = picked
                m = self._by_thickness(picked, t, base)
                if m.status == "matched":
                    m.status = "suggested"
                m.note = "; ".join(x for x in (m.note, note) if x)
                return m
            if rule.picker in NOMINAL_PICKERS:  # picker already mapped actual -> nominal size
                return self._resolve(picked, t, [c.id for c in picked], "matched", base)
            cands = picked
        return self._by_thickness(cands, t, base)

    # -- generic thickness / source resolution
    def _by_thickness(self, cands: list[DbRow], t: float | None, base: dict) -> Match:
        ids = [c.id for c in cands]
        if len(cands) == 1 and cands[0].t_in is None:
            return self._done("matched", cands[0], t, ids, "", base)

        fixed = [c for c in cands if c.t_in is not None and c.psf_per_in is None]
        per_in = [c for c in cands if c.psf_per_in is not None]
        flat = [c for c in cands if c.t_in is None]

        if t:
            exact = [c for c in fixed if abs(c.t_in - t) <= TOL_EXACT_IN]
            if exact:
                return self._resolve(exact, t, ids, "matched", base)
            if per_in:
                return self._resolve(per_in, t, ids, "matched", base, note=f"psf/in x {t:g}\"")
            if fixed:
                near = min(fixed, key=lambda c: abs(c.t_in - t))
                if abs(near.t_in - t) <= TOL_NEAR * t:
                    peers = [c for c in fixed if c.t_in == near.t_in]
                    return self._resolve(peers, t, ids, "suggested", base, note=f"nearest DB thickness {near.t_in:g}\" vs layer {t:g}\"")
        if flat and not (t and fixed):  # a thickness-free row only stands in when no sized rows exist
            return self._resolve(flat, t, ids, "matched", base)
        if per_in and not t:
            return Match("ambiguous", candidates=ids, note="layer has no thickness", **base)
        return Match("ambiguous", candidates=ids, note=f"no DB thickness close to {t:g}\"" if t else "", **base)

    def _resolve(self, rows: list[DbRow], t, ids, status, base, note="") -> Match:
        if len(rows) == 1:
            return self._done(status, rows[0], t, ids, note, base)
        psfs = {r.psf_at(t) for r in rows}
        firm = [r for r in rows if r.source.lower().startswith("firm")]
        if len(psfs) == 1:  # same weight from several sources: any is fine, prefer firm
            return self._done(status, (firm or rows)[0], t, ids, note, base)
        if len(firm) == 1:
            return self._done("suggested", firm[0], t, ids, (note + "; " if note else "") + "firm value preferred over ASCE", base)
        return Match("ambiguous", candidates=[r.id for r in rows], note=note or "several rows fit", **base)

    @staticmethod
    def _done(status, row: DbRow, t, ids, note, base) -> Match:
        return Match(status, row_id=row.id, psf=row.psf_at(t), candidates=ids, note=note, **base)

    # -- pickers: narrow the candidate rows using modifiers
    def _pick_concrete(self, cands, norm, ctx, t, kind):
        lw = re.search(r"light ?weight|ltwt|\blwc?\b|\blw\b", ctx)
        want = r"^lightweight concrete$" if lw else r"^normal weight concrete$"
        return [c for c in cands if re.search(want, c.material)] or cands

    def _pick_cmu(self, cands, norm, ctx, t, kind):
        if t:
            nominal = 2 * round((t + 0.375) / 2)  # 7 5/8" actual -> 8" nominal
            by_t = [c for c in cands if c.t_in == nominal and c.psf_per_in is None]
            if not by_t or abs(t - (nominal - 0.375)) > 0.25:
                per_in = [c for c in cands if c.psf_per_in is not None]
                return per_in, f"{t:g}\" is not a standard CMU size; per-inch solid grout row used"
            cands = by_t
        if re.search(r"solid(ly)? grout|fully grouted|\bfg\b|solid grout", ctx):
            cands = [c for c in cands if "solid grout" in c.info] or cands
        elif m := re.search(r'grout(ed)?\s*@\s*(\d{2})', ctx):
            cands = [c for c in cands if f"grout @ {m.group(2)} in" in c.info] or cands
        elif re.search(r"ungrouted|hollow|no grout", ctx):
            cands = [c for c in cands if "no grout" in c.info] or cands
        for pat, pcf in [(r"light ?weight|\blw\b", "105"), (r"medium ?weight", "125"), (r"normal ?weight|\bnw\b", "135")]:
            if re.search(pat, ctx):
                cands = [c for c in cands if f"{pcf} pcf" in c.info] or cands
        return [c for c in cands if "solid units" not in c.material] or cands

    def _pick_brick(self, cands, norm, ctx, t, kind):
        per_in = [c for c in cands if c.psf_per_in is not None]
        if t and t >= 3:  # full wythe: 3 5/8" actual -> 4" nominal
            nominal = 4 * round((t + 0.375) / 4) or 4
            wythe = [c for c in cands if c.t_in == nominal and c.psf_per_in is None]
            if wythe and abs(t - (nominal - 0.375)) <= 0.25:
                return wythe
            return per_in, f"{t:g}\" is not a standard wythe; per-inch row used"
        return per_in, "thin brick; per-inch row used"

    def _pick_lumber(self, cands, norm, ctx, t, kind):
        nominal = {3.5: "2x4", 5.5: "2x6", 7.25: "2x8", 9.25: "2x10", 11.25: "2x12"}
        size = next((n for a, n in nominal.items() if t and abs(t - a) <= 0.13), None)
        if not size:
            return []  # not a sawn size (I-joist, built-up): nothing in the DB fits
        cands = [c for c in cands if c.info.startswith(size + " ")]
        if kind == "floor" and re.search(r"joist", norm):
            cands = [c for c in cands if c.material == "wood joist"] or cands
        else:
            cands = [c for c in cands if c.material.startswith("douglas fir")] or cands
        sp = spacing_oc(ctx)
        if sp:
            return [c for c in cands if f"@ {sp} in" in c.info] or cands
        # spacing is almost never in the model; 16" o.c. is the common default
        sixteen = [c for c in cands if "@ 16 in" in c.info]
        return (sixteen, "spacing not in model; 16 in. o.c. assumed") if sixteen else cands

    def _pick_deck(self, cands, norm, ctx, t, kind):
        ga = gauge(ctx)
        if ga:
            return [c for c in cands if c.info.startswith(f"{ga} gauge")] or cands
        return cands

    def _pick_panel_only(self, cands, norm, ctx, t, kind):
        return [c for c in cands if "panel only" in c.info] or cands

    def _pick_sprayfoam(self, cands, norm, ctx, t, kind):
        if "open" in ctx:
            return [c for c in cands if c.material.startswith("open")]
        if "closed" in ctx:
            return [c for c in cands if c.material.startswith("closed")]
        return cands


# ---------------------------------------------------------------- structural guess

STRUCT_PRIORITY = ["Concrete", "CMU", "Masonry", "Mass timber", "Steel deck", "Wood joist/truss",
                   "Metal stud", "Wood stud", "Steel", "Glass"]


def structural_guess(layers: list[dict]) -> dict | None:
    """Pick the layer most likely to be the assembly's structure.

    Revit's own Structural Material / layer function are not in the IFC export, so
    this is a guess: highest-priority structural class, thickest layer on ties.
    """
    best = None
    for i, layer in enumerate(layers):
        cls = (layer.get("match") or {}).get("structural")
        if not cls:
            continue
        if cls == "Masonry" and (layer.get("thickness_in") or 0) < 3:
            continue  # thin brick is a finish
        key = (STRUCT_PRIORITY.index(cls), -(layer.get("thickness_in") or 0))
        if best is None or key < best[0]:
            best = (key, i, cls, layer)
    if best is None:
        return None
    _, i, cls, layer = best
    return {"layer_index": i, "class": cls, "material": layer["material"],
            "reason": f"{cls.lower()} layer ({layer.get('thickness_in') or 0:g}\")"}
