// Maps the API's materials rows and gravity_ifc extraction onto the wizard's data model.
import type { IfcResult, IfcType, MaterialInput, MaterialRow } from '../api';
import { MATERIALS, uid, type ElementType, type Kind, type Layer, type Level, type Material, type Plan, type Pt } from './data';

/**
 * Kim's row label, as gravity_ifc's DbRow.label(): 8" cmu - wall (solid grout; 105 pcf unit).
 * Per-inch rows leave the dimension out: their 1" is the formula's reference, not a size.
 */
export function rowLabel(r: MaterialRow): string {
  const dim = r.t_in != null && r.psf_per_in == null ? `${+r.t_in.toFixed(3)}" ` : '';
  const info = r.info && r.info !== '--' ? ` (${r.info})` : '';
  return `${dim}${r.material}${r.use ? ` - ${r.use}` : ''}${info}`;
}

/**
 * One materials-DB row → one app material. Per-inch rows become PCF (pcf = 12 × psf/in) so the
 * psf follows the layer thickness; fixed rows are PSF and ignore thickness, as in gravity_ifc.
 */
export function rowToMaterial(r: MaterialRow): Material {
  const perIn = r.psf_per_in != null;
  return {
    id: r.id,
    name: rowLabel(r),
    category: r.use || 'Uncategorised',
    basis: perIn ? 'PCF' : 'PSF',
    unitWeight: perIn ? +(r.psf_per_in! * 12).toFixed(4) : r.psf ?? 0,
    thicknesses: [r.t_in ?? 0],
    custom: r.custom,
    orientation: r.orientation,
    source: r.source,
  };
}

/** App material (Add material form) → materials-DB row. */
export function materialToRow(m: Omit<Material, 'id'>): MaterialInput {
  const t = m.thicknesses[0] || null;
  const pcf = m.basis === 'PCF';
  return {
    material: m.name,
    use: m.category,
    t_in: t,
    psf_per_in: pcf ? m.unitWeight / 12 : null,
    psf: pcf ? (t ? +((m.unitWeight * t) / 12).toFixed(2) : null) : m.unitWeight,
    source: 'User',
  };
}

/** Unit-weight edit on the Materials DB page → the row fields that hold it. */
export function unitWeightPatch(m: Material, unitWeight: number): Partial<MaterialInput> {
  const t = m.thicknesses[0] || null;
  return m.basis === 'PCF'
    ? { psf_per_in: unitWeight / 12, psf: t ? +((unitWeight * t) / 12).toFixed(2) : null }
    : { psf: unitWeight };
}

/** The Demo project's own 15 sample materials, kept so its numbers do not change. Not DB rows. */
export const DEMO_MATERIALS: Material[] = MATERIALS.map((m) => ({ ...m, demo: true, source: 'Demo sample' }));

const PALETTE = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#a16207', '#dc2626', '#db2777',
  '#b45309', '#475569', '#0284c7', '#65a30d', '#7c2d12', '#be185d', '#0f766e', '#4f46e5'];

const KIND: Record<IfcType['kind'], Kind> = { floor: 'floor', roof: 'floor', ceiling: 'floor', wall: 'wall', curtain_wall: 'wall' };

const r1 = (n: number | undefined | null) => Math.round((n ?? 0) * 10) / 10;

/** Fields the user decides per type; saved per model in model_type_decisions. */
export const DECISION_KEYS = ['include', 'assemblyName', 'layers', 'status', 'allowance', 'parentId', 'structuralMaterial', 'materialVerified'] as const;

export function decisionOf(t: ElementType): Record<string, unknown> {
  return Object.fromEntries(DECISION_KEYS.map((k) => [k, t[k]]));
}

function typeFromIfc(t: IfcType, i: number): ElementType {
  const kind = KIND[t.kind];
  const structural = t.structural_guess?.material ?? t.group ?? 'Not identified';
  const layers: Layer[] = t.layers.map((l) => ({
    id: uid('l'),
    materialId: l.match?.row_id ?? '',
    thickness: l.thickness_in ?? 0,
    overridePsf: null,
    revit: { material: l.material, status: l.match?.status ?? 'unknown', candidates: l.match?.candidates ?? [], note: l.match?.note },
  }));
  const shortName = t.name.includes(':') ? t.name.slice(t.name.indexOf(':') + 1) : t.name;
  return {
    id: t.id,
    kind,
    ifcKind: t.kind,
    name: t.name,
    revitMaterial: structural,
    instances: t.instances,
    modelQty: r1(kind === 'floor' ? t.qty.plan_area_sf : t.qty.length_lf),
    height: kind === 'wall' ? r1(t.qty.avg_height_ft) : undefined,
    netArea: kind === 'wall' ? r1(t.qty.net_area_sf) : undefined,
    color: PALETTE[i % PALETTE.length],
    include: t.instances > 0,
    structuralMaterial: structural,
    materialVerified: false,
    assemblyName: shortName,
    layers,
    status: 'todo',
    allowance: null,
    parentId: null,
    flags: t.flags ?? [],
  };
}

// IFC plans are north-up (y grows north); SVG y grows down, so y is flipped once here.
const flip = (p: [number, number]): Pt => [p[0], -p[1]];

function plansFromIfc(result: IfcResult): Plan {
  const levels: Level[] = result.levels
    .filter((lv) => result.plan[String(lv.id)])
    .map((lv) => {
      const p = result.plan[String(lv.id)];
      return {
        id: String(lv.id),
        name: lv.name,
        elevationFt: lv.elevation_ft,
        minor: lv.minor,
        areas: p.zones
          .filter((z) => z.polygons.length)
          .map((z, i) => {
            const polys = z.polygons.map((g) => ({ outer: g.outer.map(flip), holes: g.holes.map((h) => h.map(flip)) }));
            return {
              id: `${lv.id}-z${i}`,
              typeId: z.type_ids[0],
              stackTypeIds: z.type_ids,
              points: polys[0].outer,
              polys,
              areaSf: z.area_sf,
              label: z.label_xy ? flip(z.label_xy) : polys[0].outer[0],
            };
          }),
        walls: p.walls
          .filter((w) => w.points.length >= 2)
          .map((w) => ({ id: String(w.element_id), typeId: w.type_id, points: w.points.map(flip), netAreaSf: w.net_area_sf })),
      };
    });
  return { levels, grid: null };
}

/** Extraction + saved decisions → the wizard's types and plans. */
export function fromModel(result: IfcResult, decisions: Record<string, Record<string, unknown>>): { types: ElementType[]; plan: Plan } {
  const types = result.types.map((t, i) => {
    const base = typeFromIfc(t, i);
    return decisions[t.id] ? ({ ...base, ...decisions[t.id] } as ElementType) : base;
  });
  return { types, plan: plansFromIfc(result) };
}
