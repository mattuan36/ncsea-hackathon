import { apiBase, SkyCivError, type SiteReport } from "./skyciv";

export const COMPARE_CLASSES = ["A", "B", "BC", "C", "CD", "D", "DE", "E"] as const;

export interface DirectionInput {
  direction: "X" | "Y";
  combination: "single" | "horizontal" | "vertical";
  system_ids: string[];
  period_analysis_sec: number | null;
  period_type_override: string | null;
  moment_frames_resist_100pct: boolean;
}

export interface SeismicInputs {
  project_number: string;
  asce_edition: "7-22";
  source_status: string;
  sds: number | null;
  sd1: number | null;
  s1: number | null;
  tl: number | null;
  risk_category: string | null;
  site_class: string;
  part1_sdc: string;
  hn_ft: number | null;
  stories_above_base: number | null;
  weight_kips: number | null;
  directions: DirectionInput[];
  apply_sds_cap_12_8_1_3: boolean;
  confirm_regular_no_irregularities: boolean;
  confirm_rho_equals_1: boolean;
  engineer_reviewed: boolean;
}

export interface KnownSiteClass {
  siteClass: string;
  sds: number;
  sd1: number;
  s1: number;
  tl: number;
  sdc: string;
}

export interface DirectionCs {
  cs: number;
  governing: string;
  base_shear_kips: number | null;
  symbolic_base_shear: string;
  system_ids: string[];
}

export interface SiteClassRow {
  siteClass: string;
  sds: number | null;
  sd1: number | null;
  s1: number | null;
  tl: number | null;
  sdc: string;
  error: string | null;
  result: {
    sdc: string;
    directions: Record<"X" | "Y", DirectionCs>;
  } | null;
}

export interface ClassCache {
  key: string;
  fingerprint: string;
  rows: SiteClassRow[];
}

export function siteKey(lat: number, lng: number, designCode: string, risk: string): string {
  return `${lat.toFixed(6)}|${lng.toFixed(6)}|${designCode}|${risk}`;
}

export function inputFingerprint(inputs: SeismicInputs, risk: string): string {
  return JSON.stringify({
    risk,
    hn_ft: inputs.hn_ft,
    stories_above_base: inputs.stories_above_base,
    weight_kips: inputs.weight_kips,
    directions: inputs.directions,
    apply_sds_cap_12_8_1_3: inputs.apply_sds_cap_12_8_1_3,
    confirm_regular_no_irregularities: inputs.confirm_regular_no_irregularities,
    confirm_rho_equals_1: inputs.confirm_rho_equals_1,
  });
}

export function fixedRisk(value: string | null, fallback: string): "I" | "II" | "III" | "IV" {
  if (value === "I" || value === "II" || value === "III" || value === "IV") return value;
  if (fallback === "I" || fallback === "II" || fallback === "III" || fallback === "IV") return fallback;
  return "II";
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function knownFromReport(report: SiteReport | null, lat: number, lng: number, designCode: string, risk: string): KnownSiteClass | null {
  if (!report || report.designCode !== designCode || report.riskCategory !== risk) return null;
  if (Math.abs(report.latitude - lat) > 1e-5 || Math.abs(report.longitude - lng) > 1e-5) return null;
  const siteClass = report.siteClass ?? "";
  if (!COMPARE_CLASSES.includes(siteClass as (typeof COMPARE_CLASSES)[number])) return null;
  const sds = finite(report.seismic.sds);
  const sd1 = finite(report.seismic.sd1);
  const s1 = finite(report.seismic.s1);
  const tl = finite(report.seismic.tl);
  if (sds == null || sd1 == null || s1 == null || tl == null || tl <= 0) return null;
  const sdc = typeof report.seismic.sdc === "string" ? report.seismic.sdc : "";
  return { siteClass, sds, sd1, s1, tl, sdc };
}

export function knownFromRows(rows: SiteClassRow[]): KnownSiteClass[] {
  return rows.flatMap((row) => {
    if (row.error || row.sds == null || row.sd1 == null || row.s1 == null || row.tl == null || row.tl <= 0) return [];
    return [{ siteClass: row.siteClass, sds: row.sds, sd1: row.sd1, s1: row.s1, tl: row.tl, sdc: row.sdc ?? "" }];
  });
}

export function mergeKnown(fromReport: KnownSiteClass | null, cached: KnownSiteClass[]): KnownSiteClass[] {
  const byClass = new Map<string, KnownSiteClass>();
  if (fromReport) byClass.set(fromReport.siteClass, fromReport);
  for (const item of cached) byClass.set(item.siteClass, item);
  return COMPARE_CLASSES.flatMap((siteClass) => {
    const item = byClass.get(siteClass);
    return item ? [item] : [];
  });
}

export function inputProblem(inputs: SeismicInputs): string {
  if (inputs.hn_ft == null || inputs.hn_ft <= 0) {
    return "Enter the structural height on Cs and base shear before comparing site classes.";
  }
  for (const direction of inputs.directions) {
    if (!direction.system_ids.length) return `Select a lateral system for direction ${direction.direction}.`;
  }
  return "";
}

export async function fetchSiteClasses(input: {
  lat: number;
  lng: number;
  designCode: string;
  riskCategory: string;
  inputs: SeismicInputs;
  known: KnownSiteClass[];
}): Promise<SiteClassRow[]> {
  const risk = fixedRisk(input.riskCategory, "II");
  const body = {
    lat: input.lat,
    lng: input.lng,
    designCode: input.designCode,
    riskCategory: risk,
    known: input.known,
    inputs: {
      ...input.inputs,
      asce_edition: "7-22",
      risk_category: risk,
      sds: input.inputs.sds ?? 0,
      sd1: input.inputs.sd1 ?? 0,
      s1: input.inputs.s1 ?? 0,
      tl: input.inputs.tl && input.inputs.tl > 0 ? input.inputs.tl : 8,
    },
  };
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/site-report/site-classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the site API.";
    throw new SkyCivError(message);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      detail = parsed.detail ?? text;
    } catch {
      if (text.includes("<")) detail = "The site API is not connected to this page.";
    }
    throw new SkyCivError(detail || `The site API returned HTTP ${response.status}.`);
  }
  const parsed = JSON.parse(text) as { siteClasses: SiteClassRow[] };
  return parsed.siteClasses;
}
