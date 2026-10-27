import { downloadUrl, fetchDocuments, fetchFolders } from "../api";
import { loadLocalDocuments } from "../localDocuments";

/** Same Revit CSV contract as code/part3_seismic_base_shear/exchange.py. */
const REVIT_MAP: Record<string, string> = {
  BP_HZ_PROJECT_NUMBER: "project_number",
  BP_HZ_ASCE_EDITION: "asce_edition",
  BP_HZ_RISK_CATEGORY: "risk_category",
  BP_HZ_SITE_CLASS: "site_class",
  BP_HZ_SDC: "sdc",
  BP_HZ_SDS: "sds_g",
  BP_HZ_SD1: "sd1_g",
  BP_HZ_S1: "s1_g",
  BP_HZ_TL: "tl_sec",
  BP_HZ_W_PRELIM: "weight_kips",
};

const NUMERIC = ["s1_g", "sds_g", "sd1_g", "tl_sec"] as const;
const SOURCE_STATUSES = new Set(["SYNTHETIC_DEMO", "ASCE_API_UNVERIFIED", "SKYCIV_GETSITEDATA"]);

export interface HazardImport {
  project_number: string;
  source_status: string;
  sds: number;
  sd1: number;
  s1: number;
  tl: number;
  risk_category: string;
  site_class: string;
  part1_sdc: string;
  weight_kips: number | null;
  exchange_rows: unknown[];
  warnings: string[];
}

export interface DocumentPick {
  key: string;
  filename: string;
  uploaded_at: string;
  load: () => Promise<File>;
}

export function parseHazardCsv(text: string): HazardImport {
  const table = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!table.length) throw new Error("CSV has no header row. Expected parameter_name.");
  const header = new Map<string, number>();
  table[0].forEach((name, index) => header.set(name.trim().toLowerCase(), index));
  if (!header.has("parameter_name")) throw new Error("Unrecognized CSV header. Expected parameter_name.");

  const cell = (row: string[], name: string) => {
    const index = header.get(name);
    return index == null ? "" : (row[index] ?? "").trim();
  };
  const values: Record<string, string> = {};
  const rows: unknown[] = [];
  let sdsSource = "";
  let sdsConfirmed = "NO";
  for (const row of table.slice(1)) {
    const name = cell(row, "parameter_name");
    if (!name) continue;
    const value = cell(row, "value");
    const unit = cell(row, "units");
    const source = cell(row, "source_status");
    const confirmed = cell(row, "engineer_confirmed") || "NO";
    rows.push([name, value, unit, source, confirmed]);
    const mapped = REVIT_MAP[name];
    if (mapped) values[mapped] = value;
    if (name === "BP_HZ_SDS") {
      sdsSource = source;
      sdsConfirmed = confirmed;
    }
  }
  values.source_status = sdsSource;
  values.engineer_confirmed = sdsConfirmed;
  const missing = NUMERIC.filter((key) => !(key in values));
  if (missing.length) throw new Error(`Required keys missing: ${missing.join(", ")}. A blank hazard is not zero.`);

  const edition = values.asce_edition?.toLowerCase().replace(/\s/g, "") ?? "";
  if (edition !== "7-22" && edition !== "asce7-22") {
    throw new Error(`Part 3 supports ASCE 7-22 only; the file says ${values.asce_edition || "nothing"}.`);
  }
  const number = (key: string) => {
    const raw = (values[key] ?? "").trim();
    if (!raw) throw new Error(`Required ${key} must be a numeric hazard value; missing is not zero.`);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Required ${key} must be a numeric hazard value; missing is not zero.`);
    }
    return parsed;
  };
  const numbers = Object.fromEntries(NUMERIC.map((key) => [key, number(key)])) as Record<(typeof NUMERIC)[number], number>;
  if (numbers.tl_sec <= 0) throw new Error("TL must be positive.");
  if (!SOURCE_STATUSES.has(values.source_status)) {
    throw new Error("Unrecognized data source status; no silent source approval.");
  }
  const risk = (values.risk_category ?? "").toUpperCase();
  const warnings = ["Unverified or synthetic hazard data; engineer must independently review."];
  let riskCategory = risk;
  if (!["I", "II", "III", "IV"].includes(risk)) {
    warnings.push("Risk Category missing or not I-IV in the hazard file; engineer must enter it.");
    riskCategory = "";
  }
  let weight: number | null = null;
  if ((values.weight_kips ?? "").trim()) {
    weight = number("weight_kips");
    if (weight <= 0) throw new Error("W must be positive when provided; missing is not zero.");
  }
  const review = sdsConfirmed.toUpperCase() === "YES" ? "YES" : "NO";
  return {
    project_number: values.project_number ?? "",
    source_status: values.source_status,
    sds: numbers.sds_g,
    sd1: numbers.sd1_g,
    s1: numbers.s1_g,
    tl: numbers.tl_sec,
    risk_category: riskCategory,
    site_class: values.site_class ?? "",
    part1_sdc: (values.sdc ?? "").toUpperCase(),
    weight_kips: weight,
    exchange_rows: [
      ...rows,
      ["sds_g", numbers.sds_g, "g", values.source_status, review],
      ["sd1_g", numbers.sd1_g, "g", values.source_status, review],
      ["s1_g", numbers.s1_g, "g", values.source_status, review],
      ["tl_sec", numbers.tl_sec, "sec", values.source_status, review],
    ],
    warnings,
  };
}

export async function listHazardDocuments(): Promise<DocumentPick[]> {
  const picks: DocumentPick[] = [];
  for (const row of loadLocalDocuments()) {
    if (!/\.(csv|xlsx)$/i.test(row.filename)) continue;
    picks.push({
      key: `local-${row.id}`,
      filename: row.filename,
      uploaded_at: row.uploaded_at,
      load: async () => fileFromBase64(row.data_base64, row.filename, row.content_type),
    });
  }
  try {
    const folders = await fetchFolders();
    const site = folders.find((folder) => folder.name === "Site Reports");
    if (site) {
      const docs = await fetchDocuments(site.id);
      for (const doc of docs) {
        if (!/\.(csv|xlsx)$/i.test(doc.filename)) continue;
        if (picks.some((pick) => pick.filename === doc.filename)) continue;
        picks.push({
          key: `api-${doc.id}`,
          filename: doc.filename,
          uploaded_at: doc.uploaded_at,
          load: async () => {
            const response = await fetch(downloadUrl(doc.id));
            if (!response.ok) throw new Error(`Could not read ${doc.filename}.`);
            return new File([await response.blob()], doc.filename, { type: doc.content_type });
          },
        });
      }
    }
  } catch {
    /* Documents API is offline. Files saved in this browser are still listed. */
  }
  return picks.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

export function preferredHazardCsv(picks: DocumentPick[]): DocumentPick | undefined {
  return picks.find((pick) => /Hazard_Studio_Revit_Import\.csv$/i.test(pick.filename))
    ?? picks.find((pick) => /\.csv$/i.test(pick.filename));
}

function fileFromBase64(data: string, filename: string, type: string): File {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new File([bytes], filename, { type: type || "text/csv" });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}
