import type { ElementType, Kind, Layer, Level, Material, Pt } from './data';

export const polygonArea = (p: Pt[]) =>
  Math.abs(p.reduce((s, [x, y], i) => {
    const [x2, y2] = p[(i + 1) % p.length];
    return s + x * y2 - x2 * y;
  }, 0)) / 2;

export const polylineLength = (p: Pt[]) =>
  p.slice(1).reduce((s, [x, y], i) => s + Math.hypot(x - p[i][0], y - p[i][1]), 0);

export function calcPsf(m: Material | undefined, thickness: number): number {
  if (!m) return 0;
  if (m.basis === 'PCF') return (m.unitWeight * thickness) / 12;
  return m.psfByThickness?.[String(thickness)] ?? m.unitWeight;
}

export const layerPsf = (l: Layer, materials: Material[]) =>
  l.overridePsf ?? calcPsf(materials.find((m) => m.id === l.materialId), l.thickness);

export const assemblyPsf = (layers: Layer[], materials: Material[]) =>
  layers.reduce((s, l) => s + layerPsf(l, materials), 0);

export const totalThickness = (layers: Layer[]) => layers.reduce((s, l) => s + l.thickness, 0);

/** Layers that actually apply: a merged sub-assembly uses its governing assembly's layers. */
export function effectiveLayers(t: ElementType, types: ElementType[]): Layer[] {
  const parent = t.parentId ? types.find((x) => x.id === t.parentId) : undefined;
  return parent ? parent.layers : t.layers;
}

export interface TakeoffEntry {
  govId: string;
  kind: Kind;
  /** SF for floors, LF for walls */
  qty: number;
  kips: number;
  memberIds: string[];
}

export function levelTakeoff(level: Level, types: ElementType[], materials: Material[]): TakeoffEntry[] {
  const byId = new Map(types.map((t) => [t.id, t]));
  const out = new Map<string, TakeoffEntry>();
  /** wallAreaSf: IFC walls carry their net area (openings removed); the Demo uses height × length */
  const add = (typeId: string, kind: Kind, qty: number, wallAreaSf?: number) => {
    const t = byId.get(typeId);
    if (!t || !t.include) return;
    const govId = t.parentId ?? t.id;
    const gov = byId.get(govId) ?? t;
    const psf = assemblyPsf(gov.layers, materials);
    const kips = kind === 'floor' ? (psf * qty) / 1000 : (psf * (wallAreaSf ?? (t.height ?? 0) * qty)) / 1000;
    const e = out.get(govId) ?? { govId, kind, qty: 0, kips: 0, memberIds: [] };
    e.qty += qty;
    e.kips += kips;
    if (!e.memberIds.includes(typeId)) e.memberIds.push(typeId);
    out.set(govId, e);
  };
  // an IFC zone stacks several types (floor + hung ceiling): each one carries the zone's area
  level.areas.forEach((a) => (a.stackTypeIds ?? [a.typeId]).forEach((id) => add(id, 'floor', a.areaSf ?? polygonArea(a.points))));
  level.walls.forEach((w) => add(w.typeId, 'wall', polylineLength(w.points), w.netAreaSf));
  return [...out.values()].sort((a, b) => (a.kind === b.kind ? b.qty - a.qty : a.kind === 'floor' ? -1 : 1));
}

/** Plan area of a level, each zone once (a floor and the ceiling hung under it share one zone). */
export function levelFloorArea(level: Level, types: ElementType[]): number {
  const included = new Set(types.filter((t) => t.include).map((t) => t.id));
  return level.areas
    .filter((a) => (a.stackTypeIds ?? [a.typeId]).some((id) => included.has(id)))
    .reduce((s, a) => s + (a.areaSf ?? polygonArea(a.points)), 0);
}

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const EIGHTHS = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];

/** 3.625 → 3-5/8"; 0 → — */
export function fmtIn(t: number): string {
  if (t === 0) return '—';
  let whole = Math.floor(t);
  let e = Math.round((t - whole) * 8);
  if (e === 8) {
    whole += 1;
    e = 0;
  }
  if (!whole) return `${EIGHTHS[e]}"`;
  return e ? `${whole}-${EIGHTHS[e]}"` : `${whole}"`;
}

export const basisLabel = (m: Material) =>
  m.basis === 'PCF' ? `${fmt(m.unitWeight, 0)} pcf` : `${fmt(m.unitWeight, 1)} psf`;
