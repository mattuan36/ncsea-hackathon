import { exportFilename } from "./hazardExport";
import { PdfDoc } from "./pdfDoc";

export interface CsDirectionReport {
  axis: "X" | "Y";
  combination: string;
  systemIds: string[];
  systemNames: string[];
  period: string;
  momentFrames: boolean;
  cs: number;
  governing: string;
  baseShear: string;
  tUsed: number;
  tBasis: string;
  r: number;
  omega0: number;
  cd: number;
  periodType: string;
  ta: number;
  cuTa: number;
  sdsUsed: number;
  limit: string;
  rule: string;
  capStatus: string;
}

export interface CsReportData {
  project: string;
  source: string;
  risk: string;
  siteClass: string;
  sds: string;
  sd1: string;
  s1: string;
  tl: string;
  reportedSdc: string;
  hn: string;
  stories: string;
  weight: string;
  ie: number;
  sdc: string;
  sdcBasis: string;
  cu: number;
  directions: CsDirectionReport[];
  warnings: string[];
  notes: string[];
}

const COMBINATION: Record<string, string> = {
  single: "Single system",
  horizontal: "Horizontal combination, same direction",
  vertical: "Vertical combination, upper over lower",
};

export function csReportPdf(data: CsReportData): Uint8Array {
  const issued = new Date().toISOString().slice(0, 10);
  const doc = new PdfDoc(
    { left: data.project || "Project", center: "ASCE 7-22", right: issued },
    "Preliminary ELF calculation. Not for construction until an engineer confirms the inputs.",
  );
  doc.title("Seismic Cs and base shear");
  doc.italicNote("ASCE 7-22 Section 12.8. This sheet records the values calculated in Lateral, step 2.");

  doc.heading("1.  HAZARD AND BUILDING");
  doc.keyValues([
    ["Project", data.project || "—"],
    ["Source", data.source || "—"],
    ["Risk category", data.risk || "—"],
    ["Site class", data.siteClass || "—"],
    ["SDS", data.sds || "—"],
    ["SD1", data.sd1 || "—"],
    ["S1", data.s1 || "—"],
    ["TL", data.tl ? `${data.tl} s` : "—"],
    ["Reported SDC", data.reportedSdc || "—"],
    ["hn", data.hn ? `${data.hn} ft` : "—"],
    ["Stories above base", data.stories || "—"],
    ["W", data.weight ? `${data.weight} kips` : "Not supplied"],
  ]);

  doc.heading("2.  GLOBAL RESULT");
  doc.keyValues([
    ["Importance factor Ie", String(data.ie)],
    ["Seismic design category", data.sdc],
    ["Cu", data.cu.toFixed(3)],
    ["SDC basis", data.sdcBasis],
  ]);

  data.directions.forEach((direction, index) => {
    doc.heading(`${index + 3}.  DIRECTION ${direction.axis}`);
    doc.body(`${COMBINATION[direction.combination] ?? direction.combination}. ${direction.rule}`);
    const systems = direction.systemIds.map((id, i) => `${id} ${direction.systemNames[i] ?? ""}`.trim()).join("; ");
    doc.table(
      ["Item", "Value"],
      [
        ["Lateral system", systems || "—"],
        ["R / Omega0 / Cd", `${direction.r} / ${direction.omega0} / ${direction.cd}`],
        ["Analysis period", direction.period ? `${direction.period} s` : "Not provided; Ta is used"],
        ["Moment frames resist 100%", direction.momentFrames ? "Yes" : "No"],
        ["Period type", direction.periodType],
        ["Ta", `${direction.ta.toFixed(3)} s`],
        ["Cu Ta", `${direction.cuTa.toFixed(3)} s`],
        ["T used", `${direction.tUsed.toFixed(3)} s`],
        ["T basis", direction.tBasis],
        ["SDS used for Cs", direction.sdsUsed.toFixed(3)],
        ["Cs", direction.cs.toFixed(5)],
        ["Governing equation", direction.governing],
        ["Base shear V", direction.baseShear],
        ["Height limit", direction.limit],
        ["Section 12.8.1.3", direction.capStatus],
      ],
      [180, 336],
    );
  });

  doc.heading("5.  WARNINGS");
  if (data.warnings.length) data.warnings.forEach((warning, i) => doc.body(`${i + 1}.  ${warning}`));
  else doc.body("None.");

  doc.heading("6.  NOTES");
  data.notes.forEach((note, i) => doc.body(`${i + 1}.  ${note}`));

  doc.heading("7.  LIMITATIONS");
  doc.body("1.  Warnings do not stop the calculation. A system that is not permitted still returns Cs.");
  doc.body("2.  ELF eligibility, irregularities, redundancy, and vertical distribution are not checked.");
  doc.body("3.  When W is blank, base shear stays symbolic. A blank weight is not zero.");
  doc.body("4.  The Section 12.8.1.3 cap in this tool is not verified against the ASCE 7-22 text.");

  doc.heading("8.  ENGINEER CONFIRMATION");
  doc.body("Do not use these coefficients until the following are checked and signed.");
  doc.checkbox("SDS, SD1, S1, and TL match the hazard source for this site.");
  doc.checkbox("Risk category and site class match the building and the geotechnical data.");
  doc.checkbox("The lateral system, R, Omega0, and Cd match the intended framing.");
  doc.checkbox("The period basis and the moment-frame confirmation are correct.");
  doc.checkbox("Effective seismic weight W is supplied before V is used.");
  doc.gap(8);
  doc.signOff([
    ["Prepared by / date", `Application / ${issued}`],
    ["Checked by / date", ""],
    ["Engineer of record / date", ""],
  ]);
  return doc.build();
}

export function csReportFile(data: CsReportData): File {
  return new File(
    [new Uint8Array(csReportPdf(data))],
    exportFilename(data.project, "Seismic_Cs_Base_Shear.pdf"),
    { type: "application/pdf" },
  );
}
