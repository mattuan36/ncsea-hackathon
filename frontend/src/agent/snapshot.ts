import { LEVELS, type ElementType } from '../ltl/data';
import { assemblyPsf, calcPsf, effectiveLayers, layerPsf, levelTakeoff, polygonArea, polylineLength, totalThickness } from '../ltl/calc';
import type { SiteInputs } from '../ltl/store';
import { useLtl } from '../ltl/store';
import { compareSeismicDesignCategory } from '../lateral/seismic';

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function scalars(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'number' ? r(v, 4) : v;
  }
  return out;
}

type LtlValue = ReturnType<typeof useLtl>;

/** Everything the assistant may answer from. Computed with the app's own calc functions. */
export function buildSnapshot(s: LtlValue): Record<string, unknown> {
  const { types, materials, projectName, model, gravityStep } = s;
  const byId = new Map(types.map((t) => [t.id, t]));
  const typeName = (id: string) => byId.get(id)?.assemblyName ?? id;

  const assemblies = types.map((t: ElementType) => {
    const layers = effectiveLayers(t, types);
    return {
      id: t.id,
      kind: t.kind,
      revitTypeName: t.name,
      assemblyName: t.assemblyName,
      included: t.include,
      status: t.status,
      mergedInto: t.parentId ? typeName(t.parentId) : null,
      structuralMaterial: t.structuralMaterial,
      materialVerified: t.materialVerified,
      allowance: t.allowance,
      instancesInModel: t.instances,
      modelQty: t.modelQty,
      qtyUnit: t.kind === 'floor' ? 'SF' : 'LF',
      wallHeightFt: t.height ?? null,
      thicknessIn: r(totalThickness(layers)),
      totalPsf: r(assemblyPsf(layers, materials)),
      layers: layers.map((l) => {
        const m = materials.find((x) => x.id === l.materialId);
        return {
          material: m?.name ?? l.materialId,
          category: m?.category ?? null,
          thicknessIn: l.thickness,
          psf: r(layerPsf(l, materials)),
          psfOverridden: l.overridePsf != null,
        };
      }),
    };
  });

  const levels = LEVELS.map((lv) => {
    const entries = levelTakeoff(lv, types, materials).map((e) => ({
      assembly: typeName(e.govId),
      kind: e.kind,
      qty: r(e.qty, 1),
      qtyUnit: e.kind === 'floor' ? 'SF' : 'LF',
      kips: r(e.kips),
    }));
    return {
      level: lv.name,
      floorAreaSF: r(lv.areas.reduce((a, x) => a + polygonArea(x.points), 0), 1),
      wallLengthLF: r(lv.walls.reduce((a, x) => a + polylineLength(x.points), 0), 1),
      totalKips: r(entries.reduce((a, e) => a + e.kips, 0)),
      takeoff: entries,
    };
  });

  const byAssembly = new Map<string, number>();
  levels.forEach((lv) => lv.takeoff.forEach((e) => byAssembly.set(e.assembly, (byAssembly.get(e.assembly) ?? 0) + e.kips)));

  return {
    project: projectName,
    modelSource: model?.label ?? 'sample model (no model imported)',
    gravity: {
      currentStep: ['Model', 'Floor types', 'Wall types', 'Build assemblies', 'Type table', 'Plan view'][gravityStep],
      totalDeadLoadKips: r(levels.reduce((a, l) => a + l.totalKips, 0)),
      kipsByAssembly: Object.fromEntries([...byAssembly].map(([k, v]) => [k, r(v)]).sort((a, b) => (b[1] as number) - (a[1] as number))),
      levels,
      assemblies,
    },
    materialsDb: materials.map((m) => ({
      name: m.name,
      category: m.category,
      basis: m.basis,
      unitWeight: m.unitWeight,
      thicknessOptionsIn: m.thicknesses,
      psfAtThickness: Object.fromEntries(m.thicknesses.map((t) => [String(t), r(calcPsf(m, t))])),
      custom: !!m.custom,
    })),
    allowanceOptions: s.allowanceOptions,
    lateral: lateralSnapshot(s.siteInputs, s.siteReport),
  };
}

function lateralSnapshot(inputs: SiteInputs | null, rep: LtlValue['siteReport']) {
  if (!inputs && !rep) return { status: 'Lateral page not opened yet.' };
  if (!rep) return { status: 'No site report generated yet (user must press Generate on the Lateral page).', inputs };
  const check = compareSeismicDesignCategory(rep.seismic.sds, rep.seismic.sd1, rep.riskCategory, rep.seismic.sdc);
  return {
    inputs,
    site: { address: rep.address, latitude: rep.latitude, longitude: rep.longitude, elevationM: rep.elevationM },
    wind: { speed: rep.windSpeed, unit: rep.windUnit, byRiskCategory: rep.windByCategory },
    snow: scalars(rep.snow),
    seismic: { ...scalars(rep.seismic), computedSeismicDesignCategory: check.governing },
    spectra: Object.fromEntries(
      Object.entries(rep.spectra).map(([name, sp]) => {
        const ords = sp.ordinates ?? [];
        const per = sp.periods ?? [];
        const peak = ords.length ? Math.max(...ords) : null;
        return [name, { points: ords.length, peakOrdinate: peak == null ? null : r(peak, 4), periodAtPeak: peak == null ? null : per[ords.indexOf(peak)] ?? null }];
      }),
    ),
    notes: rep.notes,
  };
}
