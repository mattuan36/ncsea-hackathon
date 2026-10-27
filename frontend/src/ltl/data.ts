// Wireframe sample data. Model reading is simulated: these stand in for the
// floor/wall types, instances and plan geometry a Revit/IFC model would supply.

export type Kind = 'floor' | 'wall';
export type Basis = 'PCF' | 'PSF';
export type Category =
  | 'Concrete'
  | 'Steel deck'
  | 'Masonry'
  | 'Insulation'
  | 'Gypsum'
  | 'Framing'
  | 'Finish'
  | 'Roofing'
  | 'Glazing'
  | 'Allowance';

export const CATEGORIES: Category[] = [
  'Concrete', 'Steel deck', 'Masonry', 'Insulation', 'Gypsum', 'Framing', 'Finish', 'Roofing', 'Glazing', 'Allowance',
];

export interface Material {
  id: string;
  name: string;
  category: Category;
  /** PCF: unitWeight is a density, PSF = pcf × t / 12. PSF: unitWeight is per-sf (psfByThickness wins when listed). */
  basis: Basis;
  unitWeight: number;
  /** inches; [0] means not thickness-based (allowances) */
  thicknesses: number[];
  psfByThickness?: Record<string, number>;
  custom?: boolean;
}

export interface Layer {
  id: string;
  materialId: string;
  thickness: number;
  overridePsf: number | null;
}

export type TypeStatus = 'todo' | 'done' | 'skipped' | 'merged';

export interface ElementType {
  id: string;
  kind: Kind;
  name: string;
  /** structural material as read from Revit */
  revitMaterial: string;
  instances: number;
  /** model total across all levels: SF for floors, LF for walls */
  modelQty: number;
  /** walls only, ft */
  height?: number;
  color: string;
  include: boolean;
  structuralMaterial: string;
  materialVerified: boolean;
  assemblyName: string;
  layers: Layer[];
  status: TypeStatus;
  /** allowance category chosen for this assembly (e.g. MEP, Solar) */
  allowance: string | null;
  /** set when merged into another assembly as a sub-assembly; points at the governing assembly */
  parentId: string | null;
}

let seq = 0;
export const uid = (p = 'id') => `${p}${++seq}`;

// Typical values for a wireframe; verify against ASCE 7 Table C3.1-1 before design use.
export const MATERIALS: Material[] = [
  { id: 'nwc', name: 'Normal-weight concrete', category: 'Concrete', basis: 'PCF', unitWeight: 145, thicknesses: [3, 4, 4.5, 5, 6, 8, 10, 12] },
  { id: 'lwc', name: 'Lightweight concrete', category: 'Concrete', basis: 'PCF', unitWeight: 115, thicknesses: [2.5, 3, 3.25, 4, 4.5, 5] },
  { id: 'deck', name: 'Steel deck, 20 ga', category: 'Steel deck', basis: 'PSF', unitWeight: 2.3, thicknesses: [1.5, 2, 3], psfByThickness: { '1.5': 2.0, '2': 2.3, '3': 2.8 } },
  { id: 'cmu', name: 'CMU, normal weight, partially grouted', category: 'Masonry', basis: 'PSF', unitWeight: 55, thicknesses: [6, 8, 10, 12], psfByThickness: { '6': 41, '8': 55, '10': 66, '12': 77 } },
  { id: 'brick', name: 'Clay brick veneer', category: 'Masonry', basis: 'PSF', unitWeight: 39, thicknesses: [4], psfByThickness: { '4': 39 } },
  { id: 'gyp', name: 'Gypsum board', category: 'Gypsum', basis: 'PSF', unitWeight: 2.8, thicknesses: [0.5, 0.625], psfByThickness: { '0.5': 2.2, '0.625': 2.8 } },
  { id: 'stud', name: 'Metal studs @ 16" o.c.', category: 'Framing', basis: 'PSF', unitWeight: 1.5, thicknesses: [3.625, 6], psfByThickness: { '3.625': 1.5, '6': 2.0 } },
  { id: 'polyiso', name: 'Rigid insulation (polyiso)', category: 'Insulation', basis: 'PCF', unitWeight: 2, thicknesses: [1, 2, 3, 4] },
  { id: 'batt', name: 'Batt insulation', category: 'Insulation', basis: 'PSF', unitWeight: 0.5, thicknesses: [3.5, 6], psfByThickness: { '3.5': 0.5, '6': 0.8 } },
  { id: 'membrane', name: 'Single-ply roofing membrane', category: 'Roofing', basis: 'PSF', unitWeight: 0.7, thicknesses: [0.25] },
  { id: 'tile', name: 'Ceramic tile on mortar bed', category: 'Finish', basis: 'PSF', unitWeight: 16, thicknesses: [1.25] },
  { id: 'carpet', name: 'Carpet and pad', category: 'Finish', basis: 'PSF', unitWeight: 1, thicknesses: [0.5] },
  { id: 'cw', name: 'Curtain wall (glass + framing)', category: 'Glazing', basis: 'PSF', unitWeight: 15, thicknesses: [6] },
  { id: 'mep', name: 'MEP allowance', category: 'Allowance', basis: 'PSF', unitWeight: 5, thicknesses: [0] },
  { id: 'ceiling', name: 'Suspended acoustical ceiling', category: 'Allowance', basis: 'PSF', unitWeight: 1, thicknesses: [0] },
];

export const ALLOWANCE_OPTIONS = ['MEP', 'Concrete Ponding', 'Future Finish', 'Solar'];

export const STRUCTURAL_MATERIALS = [
  'Concrete, Normal Weight',
  'Concrete, Lightweight',
  'Metal - Steel Deck',
  'Masonry - Concrete Block',
  'Metal - Stud Layer',
  'Glass',
  'Default',
];

const L = (materialId: string, thickness: number): Layer => ({ id: uid('l'), materialId, thickness, overridePsf: null });

function T(
  id: string,
  kind: Kind,
  name: string,
  assemblyName: string,
  revitMaterial: string,
  instances: number,
  modelQty: number,
  color: string,
  layers: Layer[],
  height?: number,
): ElementType {
  return {
    id, kind, name, assemblyName, revitMaterial, instances, modelQty, color, layers, height,
    include: instances > 0,
    structuralMaterial: revitMaterial,
    materialVerified: false,
    status: 'todo',
    allowance: null,
    parentId: null,
  };
}

export const ELEMENT_TYPES: ElementType[] = [
  T('F1', 'floor', 'Floor - 3.25" LWC on 3" Comp Deck', 'LWC Composite Deck', 'Concrete, Lightweight', 14, 39600, '#2563eb',
    [L('carpet', 0.5), L('lwc', 3.25), L('deck', 3), L('mep', 0), L('ceiling', 0)]),
  T('F8', 'floor', 'Floor - 3.25" LWC on 3" Deck - Mech', 'LWC Deck - Mech', 'Concrete, Lightweight', 2, 3600, '#0891b2',
    [L('lwc', 3.25), L('deck', 3), L('mep', 0)]),
  T('F2', 'floor', 'Floor - 4.5" NWC on 2" Comp Deck', 'NWC Composite Deck', 'Concrete, Normal Weight', 6, 4050, '#16a34a',
    [L('nwc', 4.5), L('deck', 2), L('mep', 0)]),
  T('F3', 'floor', 'Floor - 8" Concrete Flat Plate', 'Flat Plate Core', 'Concrete, Normal Weight', 3, 5400, '#ea580c',
    [L('tile', 1.25), L('nwc', 8), L('mep', 0), L('ceiling', 0)]),
  T('F4', 'floor', 'Floor - 6" Slab on Grade', 'Slab on Grade', 'Concrete, Normal Weight', 2, 13500, '#a16207',
    [L('nwc', 6)]),
  T('F7', 'floor', 'Floor - 5" NWC Topping (old)', 'NWC Topping', 'Concrete, Normal Weight', 0, 0, '#65a30d',
    [L('nwc', 5), L('deck', 2)]),
  T('F5', 'floor', 'Roof - Metal Deck w/ Rigid Insulation', 'Roof Deck', 'Metal - Steel Deck', 4, 12150, '#9333ea',
    [L('membrane', 0.25), L('polyiso', 3), L('deck', 1.5), L('mep', 0)]),
  T('F6', 'floor', 'Generic 12"', 'Generic 12"', 'Default', 0, 0, '#64748b', [L('nwc', 12)]),

  T('W1', 'wall', 'Exterior - Brick Veneer on 6" Metal Stud', 'Brick on Stud', 'Metal - Stud Layer', 22, 960, '#dc2626',
    [L('brick', 4), L('polyiso', 2), L('stud', 6), L('gyp', 0.625)], 13.5),
  T('W4', 'wall', 'Interior - 3-5/8" Metal Stud Partition', 'Stud Partition', 'Metal - Stud Layer', 40, 700, '#db2777',
    [L('gyp', 0.625), L('stud', 3.625), L('gyp', 0.625)], 10),
  T('W8', 'wall', 'Interior - 6" Metal Stud Chase', 'Stud Chase', 'Metal - Stud Layer', 0, 0, '#be185d',
    [L('gyp', 0.625), L('stud', 6), L('gyp', 0.625)], 12),
  T('W2', 'wall', 'Exterior - 8" CMU w/ Brick Veneer', 'CMU + Brick', 'Masonry - Concrete Block', 10, 720, '#b45309',
    [L('brick', 4), L('polyiso', 2), L('cmu', 8)], 13.5),
  T('W3', 'wall', 'Interior - 8" CMU Partially Grouted', 'CMU Core Wall', 'Masonry - Concrete Block', 18, 480, '#7c2d12',
    [L('cmu', 8)], 12),
  T('W5', 'wall', 'Shaft - 12" Concrete Wall', 'Concrete Shaft', 'Concrete, Normal Weight', 4, 192, '#475569',
    [L('nwc', 12)], 13.5),
  T('W7', 'wall', 'Curtain Wall - Storefront', 'Storefront', 'Glass', 3, 120, '#0284c7',
    [L('cw', 6)], 13.5),
  T('W6', 'wall', 'Generic - 8"', 'Generic 8"', 'Default', 0, 0, '#94a3b8', [L('nwc', 8)], 10),
];

export type Pt = [number, number];

export interface PlanArea {
  id: string;
  typeId: string;
  points: Pt[];
  label: Pt;
}

export interface PlanWall {
  id: string;
  typeId: string;
  points: Pt[];
}

export interface Level {
  id: string;
  name: string;
  areas: PlanArea[];
  walls: PlanWall[];
}

// Plan coordinates in feet; building is 150' × 90' on a 30' grid.
export const PLAN_SIZE = { width: 150, height: 90 };
export const GRID_X = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ name, at: i * 30 }));
export const GRID_Y = ['1', '2', '3', '4'].map((name, i) => ({ name, at: i * 30 }));

const perimeterWalls = (north: string, south: string, storefront?: string): PlanWall[] => [
  { id: uid('w'), typeId: north, points: [[0, 90], [0, 0], [150, 0]] },
  { id: uid('w'), typeId: south, points: storefront ? [[150, 0], [150, 90], [60, 90]] : [[150, 0], [150, 90], [0, 90]] },
  ...(storefront ? [{ id: uid('w'), typeId: storefront, points: [[60, 90], [0, 90]] as Pt[] }] : []),
];

export const LEVELS: Level[] = [
  {
    id: 'L2',
    name: 'Level 2',
    areas: [
      { id: 'a1', typeId: 'F1', points: [[0, 0], [90, 0], [90, 60], [60, 60], [60, 90], [0, 90]], label: [32, 48] },
      { id: 'a2', typeId: 'F1', points: [[90, 0], [150, 0], [150, 45], [90, 45]], label: [120, 22] },
      { id: 'a3', typeId: 'F8', points: [[90, 45], [150, 45], [150, 90], [120, 90], [120, 60], [90, 60]], label: [134, 79] },
      { id: 'a4', typeId: 'F3', points: [[60, 60], [120, 60], [120, 90], [60, 90]], label: [80, 76] },
    ],
    walls: [
      ...perimeterWalls('W1', 'W2', 'W7'),
      { id: uid('w'), typeId: 'W3', points: [[60, 90], [60, 60], [120, 60], [120, 90]] },
      { id: uid('w'), typeId: 'W4', points: [[30, 0], [30, 40], [0, 40]] },
      { id: uid('w'), typeId: 'W4', points: [[90, 0], [90, 45], [150, 45]] },
      { id: uid('w'), typeId: 'W5', points: [[100, 68], [112, 68], [112, 82], [100, 82], [100, 68]] },
    ],
  },
  {
    id: 'RF',
    name: 'Roof',
    areas: [
      { id: 'r1', typeId: 'F5', points: [[0, 0], [150, 0], [150, 60], [105, 60], [105, 90], [0, 90]], label: [60, 45] },
      { id: 'r2', typeId: 'F2', points: [[105, 60], [150, 60], [150, 90], [105, 90]], label: [127, 75] },
    ],
    walls: perimeterWalls('W1', 'W2'),
  },
];
