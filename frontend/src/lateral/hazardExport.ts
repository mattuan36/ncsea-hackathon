import { compareSeismicDesignCategory } from "./seismic";
import type { SiteReport } from "./skyciv";
import { PdfDoc } from "./pdfDoc";

const CODE_LABEL: Record<string, string> = { "asce7-22": "ASCE 7-22", "asce7-16": "ASCE 7-16" };
const SEISMIC_META: Record<string, { units: string; description: string; reference: string }> = {
  ss: { units: "g", description: "Mapped MCER short-period spectral acceleration Ss", reference: "ASCE 7 Ch. 22 / 11.4.2" },
  s1: { units: "g", description: "Mapped MCER 1-second spectral acceleration S1", reference: "ASCE 7 Ch. 22 / 11.4.2" },
  fa: { units: "", description: "Short-period site coefficient Fa", reference: "ASCE 7 11.4.3" },
  fv: { units: "", description: "1-second site coefficient Fv", reference: "ASCE 7 11.4.3" },
  sms: { units: "g", description: "MCER spectral acceleration at short periods SMS = Fa Ss", reference: "ASCE 7 11.4.3" },
  sm1: { units: "g", description: "MCER spectral acceleration at 1 second SM1 = Fv S1", reference: "ASCE 7 11.4.3" },
  sds: { units: "g", description: "Design spectral acceleration at short periods SDS = (2/3) SMS", reference: "ASCE 7 11.4.5" },
  sd1: { units: "g", description: "Design spectral acceleration at 1 second SD1 = (2/3) SM1", reference: "ASCE 7 11.4.5" },
  sdc: { units: "", description: "Seismic design category from the hazard source", reference: "ASCE 7 11.6" },
  pgam: { units: "g", description: "Maximum considered earthquake geometric mean PGA", reference: "ASCE 7 11.8.3" },
  ts: { units: "s", description: "Transition period Ts = SD1 / SDS", reference: "ASCE 7 11.4.6" },
  t0: { units: "s", description: "Transition period T0 = 0.2 Ts", reference: "ASCE 7 11.4.6" },
  tl: { units: "s", description: "Long-period transition period TL", reference: "ASCE 7 11.4.6 / Ch. 22" },
};

const SEISMIC_ORDER = ["ss", "s1", "fa", "fv", "sms", "sm1", "sds", "sd1", "sdc", "pgam", "ts", "t0", "tl"];

export interface HazardRow {
  parameter_name: string;
  value: string;
  units: string;
  description: string;
  preliminary: "YES" | "NO";
  source_status: string;
  engineer_confirmed: "YES" | "NO";
}

export interface HazardPackage {
  projectName: string;
  calcNo: string;
  issued: string;
  codeLabel: string;
  windUnit: string;
  rows: HazardRow[];
  check: ReturnType<typeof compareSeismicDesignCategory>;
}

export function buildHazardPackage(report: SiteReport, projectName = "Untitled Project"): HazardPackage {
  const check = compareSeismicDesignCategory(report.seismic.sds, report.seismic.sd1, report.riskCategory, report.seismic.sdc);
  const issued = new Date().toISOString().slice(0, 10);
  const codeLabel = CODE_LABEL[report.designCode] || report.designCode;
  const windUnit = report.windUnit || "mph";
  const source = "SKYCIV_GETSITEDATA";
  const rows: HazardRow[] = [];

  const add = (
    name: string,
    value: unknown,
    units: string,
    description: string,
    sourceStatus: string,
    preliminary: "YES" | "NO" = "NO",
    digits?: number,
  ) => {
    rows.push({
      parameter_name: name,
      value: formatValue(value, digits),
      units,
      description,
      preliminary,
      source_status: sourceStatus,
      engineer_confirmed: "NO",
    });
  };

  add("BP_HZ_PROJECT_NUMBER", exportFilename(projectName, "").replace(/_$/, "") || "SITE", "", "Project number", "USER_SETTING");
  add("BP_HZ_PROJECT_NAME", projectName, "", "Project name", "USER_SETTING");
  add("BP_HZ_ISSUED", issued, "", "Calculation issue date (ISO)", "APP");
  add("BP_HZ_ADDRESS", report.address ?? "", "", "Site address resolved by the hazard source", source);
  add("BP_HZ_LATITUDE", report.latitude, "deg", "Site latitude, WGS84", "USER_SETTING", "NO", 6);
  add("BP_HZ_LONGITUDE", report.longitude, "deg", "Site longitude, WGS84", "USER_SETTING", "NO", 6);
  add(
    "BP_HZ_ELEVATION",
    report.elevationM,
    "m",
    report.elevationM != null ? `Ground elevation (${Math.round(report.elevationM * 3.280839895)} ft)` : "Ground elevation",
    report.elevationM != null ? source : "NOT_RETURNED",
    "NO",
    2,
  );
  add("BP_HZ_ASCE_EDITION", codeLabel, "", "ASCE 7 edition used for the request", "USER_SETTING");
  add("BP_HZ_RISK_CATEGORY", report.riskCategory, "", "Risk category, ASCE 7 Section 1.5", "USER_SETTING");
  add("BP_HZ_SITE_CLASS", report.siteClass ?? "", "", "Site class, ASCE 7 Chapter 20 / 11.4.3", "USER_SETTING");

  add("BP_HZ_SDC", check.reported ?? report.seismic.sdc ?? "", "", "Seismic design category from SkyCiv", source);
  add("BP_HZ_SDC_SDS", check.shortPeriod ?? "", "", "SDC from SDS and risk category, ASCE 7 Table 11.6-1", check.shortPeriod ? "COMPUTED_ASCE7_11_6" : "NOT_RETURNED");
  add("BP_HZ_SDC_SD1", check.oneSecond ?? "", "", "SDC from SD1 and risk category, ASCE 7 Table 11.6-2", check.oneSecond ? "COMPUTED_ASCE7_11_6" : "NOT_RETURNED");
  add("BP_HZ_SDC_GOVERNING", check.governing ?? "", "", "Governing SDC = max(Table 11.6-1, Table 11.6-2)", check.governing ? "COMPUTED_ASCE7_11_6" : "NOT_RETURNED");

  for (const key of SEISMIC_ORDER) {
    if (key === "sdc" || !(key in report.seismic)) continue;
    const meta = SEISMIC_META[key];
    const digits = meta?.units === "g" ? 3 : meta?.units === "s" ? 3 : undefined;
    add(`BP_HZ_${key.toUpperCase()}`, report.seismic[key], meta?.units ?? "", meta?.description ?? key, present(report.seismic[key]) ? source : "NOT_RETURNED", "NO", digits);
  }
  for (const [key, value] of Object.entries(report.seismic)) {
    if (SEISMIC_ORDER.includes(key) || key === "sdc") continue;
    if (value != null && typeof value === "object") continue;
    add(`BP_HZ_${key.toUpperCase()}`, value, "", `Additional seismic parameter ${key}`, present(value) ? source : "NOT_RETURNED");
  }

  add("BP_HZ_WIND_VULT", report.windSpeed, windUnit, `Basic wind speed V for Risk Category ${report.riskCategory} (speed, not pressure)`, present(report.windSpeed) ? source : "NOT_RETURNED", "NO", 1);
  for (const risk of ["I", "II", "III", "IV"]) {
    add(`BP_HZ_WIND_V_${risk}`, report.windByCategory[risk], windUnit, `Basic wind speed V, Risk Category ${risk}`, present(report.windByCategory[risk]) ? source : "NOT_RETURNED", "NO", 1);
  }
  for (const [name, value] of Object.entries(report.windByCategory)) {
    if (["I", "II", "III", "IV"].includes(name)) continue;
    add(`BP_HZ_WIND_V_${slugToken(name)}`, value, windUnit, `Wind speed ${name}`, present(value) ? source : "NOT_RETURNED", "NO", 1);
  }

  const snowLoad = firstPresent(report.snow, ["snow_load", "ground_snow", "pg", "pg_psf"]);
  add("BP_HZ_GROUND_SNOW", snowLoad, snowLoad != null && snowLoad !== "" ? "psf" : "", "Ground snow load pg (not roof snow pf)", present(snowLoad) ? source : "NOT_RETURNED", "NO", 1);
  if (present(report.snow.w2)) add("BP_HZ_W2", report.snow.w2, "", "Winter wind parameter W2", source);
  for (const [key, value] of Object.entries(report.snow)) {
    if (["snow_load", "ground_snow", "pg", "pg_psf", "w2"].includes(key)) continue;
    if (value != null && typeof value === "object") continue;
    add(`BP_HZ_SNOW_${slugToken(key)}`, value, "", `Snow parameter ${key}`, present(value) ? source : "NOT_RETURNED");
  }

  add("BP_HZ_R", "", "", "Response modification coefficient R. Engineer input required before Cs.", "ENGINEER_INPUT_REQUIRED", "YES");
  add("BP_HZ_IE", "", "", "Seismic importance factor Ie, ASCE 7 Table 1.5-2. Engineer input required before Cs.", "ENGINEER_INPUT_REQUIRED", "YES");
  add("BP_HZ_T", "", "s", "Fundamental period T used in ELF. Engineer input required before Cs.", "ENGINEER_INPUT_REQUIRED", "YES");
  add("BP_HZ_CS_PRELIM", "", "", "Preliminary Cs = SDS / (R/Ie), limited per ASCE 7 12.8.1.1. Blank until R, Ie, and T are provided.", "ENGINEER_INPUT_REQUIRED", "YES");
  add("BP_HZ_W_PRELIM", "", "kips", "Effective seismic weight W. Engineer supplied; never assume zero.", "ENGINEER_INPUT_REQUIRED", "YES");
  add("BP_HZ_V_PRELIM", "", "kips", "Preliminary base shear V = Cs W. Reported symbolically until W is provided.", "ENGINEER_INPUT_REQUIRED", "YES");
  add("BP_HZ_SOURCE", "SkyCiv standalone.loads.getSiteData", "", "Hazard retrieval method", "APP");
  add("BP_HZ_DISCLAIMER", "Not an official ASCE Hazard Tool Full Report. Confirm before design use.", "", "Use limitation", "APP");

  return {
    projectName,
    calcNo: "HS-SITE-001",
    issued,
    codeLabel,
    windUnit,
    rows,
    check,
  };
}

export function hazardCsv(report: SiteReport, projectName?: string): string {
  const { rows } = buildHazardPackage(report, projectName);
  const header = ["parameter_name", "value", "units", "description", "preliminary", "source_status", "engineer_confirmed"];
  const lines = [header.join(","), ...rows.map((row) => header.map((key) => csvCell(row[key as keyof HazardRow])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

export function hazardPdf(report: SiteReport, projectName?: string): Uint8Array {
  const pack = buildHazardPackage(report, projectName);
  const doc = new PdfDoc(
    { left: "B&P Hazard Studio", center: "Site Design Criteria", right: pack.calcNo },
    "Not an official ASCE Full Report. Engineer confirmation required before design use.",
  );

  doc.title("SITE DESIGN CRITERIA");
  doc.body(`${pack.codeLabel}  |  Risk Category ${report.riskCategory}  |  Site Class ${report.siteClass ?? "—"}`);
  doc.italicNote("Calculation sheet for wind speed, ground snow, and seismic parameters. Values are from SkyCiv getSiteData unless marked computed.");

  doc.heading("0.  TITLE BLOCK");
  doc.keyValues([
    ["Firm", "B&P Hazard Studio"],
    ["Project", pack.projectName],
    ["Calc. no.", pack.calcNo],
    ["Revision", "0"],
    ["Issued", pack.issued],
    ["Source", "SkyCiv Load Generator API v3"],
    ["Prepared", "Application"],
    ["Checked", "________________"],
  ]);

  doc.heading("1.  PURPOSE");
  doc.body("Record site wind, snow, and seismic design criteria for subsequent ELF, MWFRS, and snow calculations. This sheet does not compute story forces, wind pressures, or roof snow.");

  doc.heading("2.  REFERENCES");
  doc.body(`1.  ${pack.codeLabel}, Minimum Design Loads and Associated Criteria for Buildings and Other Structures.`);
  doc.body("2.  SkyCiv Load Generator, standalone.loads.getSiteData, API v3 / api_version 2.1.");
  doc.body("3.  ASCE 7 Section 11.6, Tables 11.6-1 and 11.6-2 (seismic design category).");
  doc.body("4.  ASCE 7 Section 12.8.1.1 (seismic response coefficient Cs) — listed symbolically only.");

  doc.heading("3.  SITE IDENTIFICATION");
  doc.table(
    ["Item", "Value", "Unit", "Notes"],
    [
      ["Address", report.address || "Coordinate sent to SkyCiv", "", "Resolved by hazard source"],
      ["Latitude", formatValue(report.latitude, 6), "deg", "WGS84"],
      ["Longitude", formatValue(report.longitude, 6), "deg", "WGS84"],
      ["Elevation", report.elevationM == null ? "" : `${formatValue(report.elevationM, 2)} (${Math.round(report.elevationM * 3.280839895)} ft)`, "m", "Source ground elevation"],
      ["Country", report.country || "", "", ""],
    ],
    [120, 220, 50, 126],
  );

  doc.heading("4.  DESIGN CRITERIA (INPUT)");
  doc.table(
    ["Parameter", "Symbol", "Value", "ASCE 7 reference"],
    [
      ["ASCE edition", "", pack.codeLabel, "Specified by engineer"],
      ["Risk category", "", report.riskCategory, "Section 1.5 / Table 1.5-1"],
      ["Site class", "", report.siteClass ?? "", "Chapter 20 / 11.4.3"],
    ],
    [150, 70, 80, 216],
  );
  doc.italicNote("Site class shall be confirmed by a geotechnical investigation when required by the building official. A default Site Class D request is not a substitute for that determination.");

  doc.heading("5.  WIND — BASIC SPEED V (ASCE 7 CH. 26)");
  doc.italicNote("Reported quantity is basic wind speed V, not velocity pressure qz and not MWFRS / C&C pressure.");
  const windRows = ["I", "II", "III", "IV"]
    .filter((risk) => present(report.windByCategory[risk]))
    .map((risk) => [
      `Risk Category ${risk}${risk === report.riskCategory ? " (governing for this request)" : ""}`,
      "V",
      formatValue(report.windByCategory[risk], 1),
      pack.windUnit,
    ]);
  const extraWind = Object.entries(report.windByCategory)
    .filter(([name]) => !["I", "II", "III", "IV"].includes(name))
    .map(([name, value]) => [String(name), "V", formatValue(value, 1), pack.windUnit]);
  doc.table(["Description", "Symbol", "Value", "Unit"], [...windRows, ...extraWind], [286, 70, 80, 80]);
  if (!windRows.length && !present(report.windSpeed)) doc.body("Wind speed was not returned for this site.");

  doc.heading("6.  SNOW — GROUND SNOW pg (ASCE 7 CH. 7)");
  doc.italicNote("Ground snow pg is not roof snow pf. Exposure, thermal, slope, and drift factors are not applied here.");
  const snowRows = Object.entries(report.snow)
    .filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value))
    .map(([name, value]) => [
      name === "snow_load" || name === "ground_snow" || name === "pg" ? "Ground snow load" : name,
      name === "snow_load" || name === "ground_snow" || name === "pg" ? "pg" : name,
      formatValue(value, name === "w2" ? 2 : 1),
      present(value) && (name === "snow_load" || name === "ground_snow" || name === "pg") ? "psf" : "",
    ]);
  if (snowRows.some((row) => row[2])) doc.table(["Description", "Symbol", "Value", "Unit"], snowRows, [286, 70, 80, 80]);
  else doc.body("Ground snow was not returned for this site. Do not treat a blank as zero.");

  doc.heading("7.  SEISMIC PARAMETERS (ASCE 7 CH. 11)");
  const seismicRows = SEISMIC_ORDER.filter((key) => key in report.seismic).map((key) => {
    const meta = SEISMIC_META[key];
    return [
      seismicLabel(key),
      key.toUpperCase().replace("PGAM", "PGAM"),
      formatValue(report.seismic[key], meta?.units === "g" || meta?.units === "s" ? 3 : undefined),
      meta?.units ?? "",
      meta?.reference ?? "",
    ];
  });
  doc.table(["Parameter", "Symbol", "Value", "Unit", "Reference"], seismicRows, [186, 54, 54, 40, 182]);

  doc.heading("8.  SEISMIC DESIGN CATEGORY — INDEPENDENT CHECK");
  doc.body("SDC is the more severe of Table 11.6-1 (SDS) and Table 11.6-2 (SD1) for the selected risk category. Categories E and F are not evaluated here; they require S1 and occupancy checks beyond this sheet.");
  doc.table(
    ["Check", "Input", "Result", "Rule"],
    [
      ["Table 11.6-1 (short period)", `SDS = ${formatValue(pack.check.sDs, 3)} g`, pack.check.shortPeriod ?? "", `Risk ${report.riskCategory}`],
      ["Table 11.6-2 (1 second)", `SD1 = ${formatValue(pack.check.sD1, 3)} g`, pack.check.oneSecond ?? "", `Risk ${report.riskCategory}`],
      ["Governing SDC", pack.check.governs === "both" ? "Tables 11.6-1 and 11.6-2 agree" : pack.check.governs ? `${pack.check.governs} governs` : "", pack.check.governing ?? "", "More severe of the two tables"],
      ["SkyCiv reported SDC", "", pack.check.reported ?? "", "Compared with governing value"],
    ],
    [170, 140, 70, 136],
  );
  if (pack.check.matches === true) {
    doc.body(`Independent check agrees with SkyCiv: SDC ${pack.check.governing}.`);
  } else if (pack.check.matches === false) {
    doc.body(`DISCREPANCY: governing SDC is ${pack.check.governing}; SkyCiv returned ${pack.check.reported}. Resolve before use.`);
  } else {
    doc.body("Comparison is incomplete because SDS, SD1, or a reported SDC was not available.");
  }

  doc.heading("9.  PRELIMINARY ELF (SYMBOLIC — NOT FOR DESIGN)");
  doc.body("ASCE 7 Section 12.8.1.1. R, Ie, T, and W were not supplied. Values are therefore left blank. Do not substitute zero for a missing W.");
  doc.body("Cs = SDS / (R/Ie)");
  doc.body("Cs need not exceed SD1 / [T (R/Ie)] for T <= TL; Cs need not exceed SD1 TL / [T^2 (R/Ie)] for T > TL.");
  doc.body("Cs shall not be less than 0.044 SDS Ie, and not less than 0.01. If S1 >= 0.6, Cs shall not be less than 0.5 S1 / (R/Ie).");
  doc.body("V = Cs W");
  doc.table(
    ["Parameter", "Symbol", "Value", "Unit", "Status"],
    [
      ["Response modification", "R", "", "", "Engineer input required"],
      ["Importance factor", "Ie", "", "", "Engineer input required"],
      ["Fundamental period", "T", "", "s", "Engineer input required"],
      ["Seismic response coefficient", "Cs", "", "", "Blank until R, Ie, T provided"],
      ["Effective seismic weight", "W", "", "kips", "Engineer supplied"],
      ["Base shear", "V", "Cs x W", "kips", "Symbolic"],
    ],
    [170, 50, 70, 50, 176],
  );

  if (report.notes.length) {
    doc.heading("10.  SOURCE NOTES");
    report.notes.forEach((note, i) => doc.body(`${i + 1}.  ${note}`));
  }

  doc.heading(`${report.notes.length ? "11" : "10"}.  LIMITATIONS`);
  doc.body("1.  This document is an application extract of SkyCiv site data. It is not the official ASCE 7 Hazard Tool Full Report.");
  doc.body("2.  Wind values are speeds. Convert to pressure only after exposure, topographic, directionality, and enclosure are established.");
  doc.body("3.  Snow values, when present, are ground snow. Roof snow requires Ce, Ct, Cs, and I_s.");
  doc.body("4.  Blank cells are unknown. They shall not be read as zero.");
  doc.body("5.  Response spectra plotted in the application are omitted from this sheet; use the on-screen report if spectra are required.");
  doc.body("6.  Live API retrieval consumes SkyCiv credits. Re-run if the code edition, risk category, or site class changes.");

  doc.heading(`${report.notes.length ? "12" : "11"}.  ENGINEER CONFIRMATION`);
  doc.body("Do not issue for construction until the following are checked and signed.");
  doc.checkbox("Site coordinates and address represent the intended building.");
  doc.checkbox("Risk category matches occupancy and risk, ASCE 7 Section 1.5.");
  doc.checkbox("Site class is supported by geotechnical data or an accepted default.");
  doc.checkbox("Ss, S1, SDS, SD1, TL, and SDC checked against the ASCE Hazard Tool or equivalent.");
  doc.checkbox("Wind speed checked against the applicable ASCE 7 wind map / ATC / ASCE Hazard Tool.");
  doc.checkbox("Ground snow, if used, checked against the applicable snow map and local authority.");
  doc.checkbox("R, Ie, T, and W selected before any Cs or V is used in design.");
  doc.gap(10);
  doc.signOff([
    ["Prepared by / date", "Application / " + pack.issued],
    ["Checked by / date", ""],
    ["Engineer of record / PE / date", ""],
  ]);

  return doc.build();
}

export function downloadBytes(filename: string, bytes: Uint8Array | string, mime: string) {
  const blob = new Blob([bytes] as BlobPart[], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportFilename(projectName: string, suffix: string): string {
  const slug = projectName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "Site";
  return `${slug}_${suffix}`;
}

function present(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "string" && /^not available$/i.test(value.trim())) return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  return true;
}

function firstPresent(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (present(record[key])) return record[key];
  return "";
}

function formatValue(value: unknown, digits?: number): string {
  if (!present(value)) return "";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (typeof value === "number") {
    return digits != null ? value.toFixed(digits) : Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (digits != null && Number.isFinite(Number(trimmed))) return Number(trimmed).toFixed(digits);
    return trimmed;
  }
  return "";
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function slugToken(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase() || "PARAM";
}

function seismicLabel(key: string): string {
  const labels: Record<string, string> = {
    ss: "Mapped Ss",
    s1: "Mapped S1",
    fa: "Site coefficient Fa",
    fv: "Site coefficient Fv",
    sms: "SMS = Fa Ss",
    sm1: "SM1 = Fv S1",
    sds: "SDS = (2/3) SMS",
    sd1: "SD1 = (2/3) SM1",
    sdc: "Seismic design category",
    pgam: "PGAM",
    ts: "Ts = SD1 / SDS",
    t0: "T0 = 0.2 Ts",
    tl: "TL",
  };
  return labels[key] ?? key;
}
