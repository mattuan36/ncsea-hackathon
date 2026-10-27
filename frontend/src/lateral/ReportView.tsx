import { Download } from "lucide-react";
import { useLtl } from "../ltl/store";
import { downloadBytes, exportFilename, hazardCsv, hazardPdf } from "./hazardExport";
import { compareSeismicDesignCategory } from "./seismic";
import type { SiteReport, Spectrum } from "./skyciv";

const CODE_LABEL: Record<string, string> = { "asce7-22": "ASCE 7-22", "asce7-16": "ASCE 7-16" };

const SPECTRUM_LABEL: Record<string, string> = {
  multiPeriodDesignSpectrum: "Multi-period design",
  multiPeriodMCErSpectrum: "Multi-period MCER",
  twoPeriodDesignSpectrum: "Two-period design",
  twoPeriodMCErSpectrum: "Two-period MCER",
  verticalDesignSpectrum: "Vertical design",
  verticalMCErSpectrum: "Vertical MCER",
};

const SEISMIC_ORDER = ["sdc", "ss", "s1", "fa", "fv", "sms", "sm1", "sds", "sd1", "pgam", "ts", "t0", "tl"];

export default function ReportView({ report }: { report: SiteReport }) {
  const { projectName } = useLtl();
  const check = compareSeismicDesignCategory(report.seismic.sds, report.seismic.sd1, report.riskCategory, report.seismic.sdc);
  const spectra = Object.entries(report.spectra).flatMap(([name, spectrum]) => {
    const series = usableSpectrum(spectrum);
    return series ? [[SPECTRUM_LABEL[name] ?? name, series] as const] : [];
  });
  const downloadCsv = () => {
    downloadBytes(exportFilename(projectName, "Hazard_Studio_Revit_Import.csv"), hazardCsv(report, projectName), "text/csv;charset=utf-8");
  };
  const downloadPdf = () => {
    downloadBytes(exportFilename(projectName, "Hazard_Studio_Site_Criteria.pdf"), hazardPdf(report, projectName), "application/pdf");
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">Site load report</h2>
          <p className="muted">{report.address || "Coordinate sent to SkyCiv"}</p>
        </div>
        <div className="row-gap no-print">
          <button type="button" className="btn" onClick={downloadCsv}>
            <Download size={16} /> Download CSV
          </button>
          <button type="button" className="btn" onClick={downloadPdf}>
            <Download size={16} /> Download PDF
          </button>
        </div>
      </div>
      <div className="metric-row">
        <div><span className="muted">Wind</span><strong>{formatScalar(report.windSpeed)} {report.windUnit || ""}</strong></div>
        <div><span className="muted">Seismic design category</span><strong>{check.governing || formatScalar(report.seismic.sdc)}</strong></div>
        <div><span className="muted">Site class</span><strong>{report.siteClass}</strong></div>
        <div><span className="muted">Elevation</span><strong>{elevation(report.elevationM)}</strong></div>
      </div>
      <p className="muted small">
        {CODE_LABEL[report.designCode] || report.designCode} · Risk {report.riskCategory}
        {report.country ? ` · ${report.country}` : ""} · {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
      </p>
      <p className="muted small">
        CSV is a Revit shared-parameter import (parameter_name, value, units, source). PDF is a signed calc sheet.
        Neither is an official ASCE Hazard Tool Full Report. Confirm before design use.
      </p>
      {report.notes.map((note) => <p key={note} className="banner info">{note}</p>)}

      <h3 className="section-label">Seismic design category</h3>
      <table className="data-table">
        <tbody>
          <tr><td>Short period SDS</td><td>{check.shortPeriod ?? "—"} <span className="muted">({formatScalar(check.sDs)} g)</span></td></tr>
          <tr><td>1-second SD1</td><td>{check.oneSecond ?? "—"} <span className="muted">({formatScalar(check.sD1)} g)</span></td></tr>
          <tr><td>Governing</td><td>{check.governing ?? "—"}</td></tr>
          <tr><td>SkyCiv</td><td>{check.reported ?? "—"}</td></tr>
        </tbody>
      </table>
      {check.matches === true && (
        <p className="banner ok">
          {check.governs === "both"
            ? `Short period and 1-second both give ${check.governing}, which matches SkyCiv.`
            : `${check.governs === "1-second" ? "The 1-second period" : "The short period"} governs at ${check.governing}, which matches SkyCiv.`}
        </p>
      )}
      {check.matches === false && (
        <p className="banner error">Governing category is {check.governing}. SkyCiv returned {check.reported}.</p>
      )}
      {check.matches == null && <p className="muted small">SkyCiv did not return both a category and SDS/SD1, so the comparison is incomplete.</p>}

      <h3 className="section-label">Wind by risk category</h3>
      <table className="data-table">
        <tbody>
          {["I", "II", "III", "IV"].filter((risk) => report.windByCategory[risk] != null).map((risk) => (
            <tr key={risk}><td>Category {risk}</td><td className="num">{formatScalar(report.windByCategory[risk])} {report.windUnit || ""}</td></tr>
          ))}
        </tbody>
      </table>

      <h3 className="section-label">Snow</h3>
      <ScalarTable values={report.snow} empty="Snow is not available for this site." />

      <h3 className="section-label">Seismic</h3>
      <ScalarTable values={ordered(report.seismic)} empty="Seismic parameters were not returned." />

      {spectra.length > 0 && (
        <>
          <h3 className="section-label">Response spectra</h3>
          <div className="two-col">
            {spectra.map(([title, series]) => (
              <SpectrumChart key={title} title={title} periods={series.periods} ordinates={series.ordinates} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ScalarTable({ values, empty }: { values: Record<string, unknown>; empty: string }) {
  const rows = Object.entries(values).filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value));
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <table className="data-table">
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name}><td>{name}</td><td className="num">{formatScalar(value)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function ordered(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SEISMIC_ORDER) if (key in values) result[key] = values[key];
  for (const [key, value] of Object.entries(values)) if (!(key in result)) result[key] = value;
  return result;
}

function usableSpectrum(spectrum: Spectrum): { periods: number[]; ordinates: number[] } | null {
  const periods = spectrum?.periods;
  const ordinates = spectrum?.ordinates;
  if (!Array.isArray(periods) || !Array.isArray(ordinates) || !periods.length || periods.length !== ordinates.length) return null;
  return { periods, ordinates };
}

function formatScalar(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  }
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return "—";
}

function elevation(meters: number | null): string {
  if (meters == null) return "—";
  return `${meters.toFixed(2)} m (${Math.round(meters * 3.280839895)} ft)`;
}

function SpectrumChart({ title, periods, ordinates }: { title: string; periods: number[]; ordinates: number[] }) {
  const width = 560;
  const height = 180;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const maxX = Math.max(...periods, 0.01);
  const maxY = Math.max(...ordinates, 0.01) * 1.05;
  const x = (value: number) => pad.l + ((width - pad.l - pad.r) * value) / maxX;
  const y = (value: number) => pad.t + (height - pad.t - pad.b) * (1 - value / maxY);
  const path = periods.map((period, index) => `${index === 0 ? "M" : "L"}${x(period).toFixed(1)},${y(ordinates[index]).toFixed(1)}`).join(" ");
  return (
    <figure className="spectrum-card">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="spectrum" role="img" aria-label={title}>
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} stroke="#e2e8f0" />
        <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#e2e8f0" />
        <text x={4} y={16} className="spectrum-label">{maxY.toFixed(2)}</text>
        <text x={pad.l} y={height - 8} className="spectrum-label">0</text>
        <text x={width - pad.r} y={height - 8} textAnchor="end" className="spectrum-label">{maxX.toFixed(1)} s</text>
        <path d={path} fill="none" stroke="#1d4ed8" strokeWidth="2" />
      </svg>
    </figure>
  );
}
