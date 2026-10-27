import { useState } from "react";
import { SkyCivError, type SiteReport } from "./skyciv";
import {
  COMPARE_CLASSES,
  fetchSiteClasses,
  fixedRisk,
  inputFingerprint,
  inputProblem,
  knownFromReport,
  knownFromRows,
  mergeKnown,
  siteKey,
  type ClassCache,
  type DirectionCs,
  type SeismicInputs,
  type SiteClassRow,
} from "./siteClass";

export default function SiteClassStep({
  lat,
  lng,
  designCode,
  risk,
  report,
  inputs,
  labels,
  cache,
  onCache,
  onBack,
}: {
  lat: number;
  lng: number;
  designCode: string;
  risk: string;
  report: SiteReport | null;
  inputs: SeismicInputs | null;
  labels: { X: string; Y: string };
  cache: ClassCache | null;
  onCache: (cache: ClassCache) => void;
  onBack: () => void;
}) {
  const [axis, setAxis] = useState<"X" | "Y">("X");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supported = designCode === "asce7-22";
  const chosenRisk = fixedRisk(inputs?.risk_category ?? null, risk);
  const key = siteKey(lat, lng, designCode, chosenRisk);
  const fingerprint = inputs ? inputFingerprint(inputs, chosenRisk) : "";
  const cached = cache?.key === key ? cache : null;
  const rows = cached?.rows ?? [];
  const stale = Boolean(cached && fingerprint && cached.fingerprint !== fingerprint);
  const known = mergeKnown(knownFromReport(report, lat, lng, designCode, chosenRisk), cached ? knownFromRows(cached.rows) : []);
  const missing = COMPARE_CLASSES.filter((siteClass) => !known.some((item) => item.siteClass === siteClass)).length;
  const problem = !supported ? "" : inputs ? inputProblem(inputs) : "Set the X and Y lateral systems on Cs and base shear, then open this step.";
  const projectClass = inputs?.site_class.trim() || "";

  const onRun = async () => {
    if (!inputs || problem) return;
    setBusy(true);
    setError("");
    try {
      const next = await fetchSiteClasses({
        lat,
        lng,
        designCode,
        riskCategory: chosenRisk,
        inputs,
        known,
      });
      onCache({ key, fingerprint, rows: next });
    } catch (err) {
      setError(err instanceof SkyCivError ? err.message : "Site class comparison failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2 className="card-title">Site class comparison</h2>
        {!supported && (
          <p className="banner info">
            This step calculates ASCE 7-22 Cs only. The design code on Site loads is a different edition, so this comparison does not call SkyCiv.
          </p>
        )}
        {supported && !inputs && <p className="banner info">{problem}</p>}
        {supported && inputs && (
          <>
            <p className="muted">
              Compares site classes A, B, BC, C, CD, D, DE, and E at this coordinate for risk category {chosenRisk}. The dropdown chooses the X or Y system from the previous step.
            </p>
            <div className="form-grid">
              <label className="span-2">
                Structural system
                <select value={axis} onChange={(event) => setAxis(event.target.value as "X" | "Y")}>
                  <option value="X">Direction X{labels.X ? ` · ${labels.X}` : ""}</option>
                  <option value="Y">Direction Y{labels.Y ? ` · ${labels.Y}` : ""}</option>
                </select>
              </label>
            </div>
            <p className="muted small">
              {missing === 0
                ? "Site classes for this coordinate are already loaded. Updating Cs does not use SkyCiv credits."
                : `This requests ${missing} SkyCiv site ${missing === 1 ? "report" : "reports"}, one per site class that is not already loaded, and takes about 20 seconds.`}
            </p>
            <div className="row-gap">
              <button className="btn primary" type="button" disabled={busy || Boolean(problem)} onClick={() => void onRun()}>
                {busy ? "Comparing site classes…" : cached ? "Update Cs" : "Compare site classes"}
              </button>
            </div>
            {problem && <p className="banner error">{problem}</p>}
            {error && <p className="banner error">{error}</p>}
            {stale && rows.length > 0 && (
              <p className="banner info">Height, weight, or the lateral systems changed. Update Cs to refresh the chart. Loaded site classes are kept.</p>
            )}
          </>
        )}
      </section>

      {supported && rows.length > 0 && (
        <ComparisonDashboard rows={rows} axis={axis} projectClass={projectClass} />
      )}

      <div className="step-footer">
        <button className="btn" type="button" onClick={onBack}>Back</button>
        <span />
      </div>
    </>
  );
}

export function ComparisonDashboard({
  rows,
  axis,
  projectClass,
}: {
  rows: SiteClassRow[];
  axis: "X" | "Y";
  projectClass: string;
}) {
  const points = rows.flatMap((row) => {
    const direction = row.result?.directions[axis];
    if (!direction || row.error) return [];
    return [{ siteClass: row.siteClass, cs: direction.cs }];
  });
  const project = points.find((point) => point.siteClass === projectClass);
  const highest = extreme(points, "high");
  const lowest = extreme(points, "low");
  const maxCs = Math.max(...points.map((point) => point.cs), 0.0001);

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span>Site class {projectClass || "—"}</span>
          <strong>{project ? formatCs(project.cs) : "—"}</strong>
          <span>Direction {axis}</span>
        </div>
        <div className="kpi">
          <span>Highest Cs</span>
          <strong>{highest ? formatCs(highest.cs) : "—"}</strong>
          <span>{highest ? `Site class ${highest.classes}` : "No result"}</span>
        </div>
        <div className="kpi">
          <span>Lowest Cs</span>
          <strong>{lowest ? formatCs(lowest.cs) : "—"}</strong>
          <span>{lowest ? `Site class ${lowest.classes}` : "No result"}</span>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">Cs by site class</h2>
        {points.length === 0 ? (
          <p className="muted">None of the site classes returned a Cs.</p>
        ) : (
          <div className="bars">
            {rows.map((row) => {
              const direction = row.result?.directions[axis];
              const cs = direction && !row.error ? direction.cs : null;
              const projectRow = row.siteClass === projectClass;
              return (
                <div key={row.siteClass} className="bar-row">
                  <span className="bar-label">{row.siteClass}{projectRow ? " · project" : ""}</span>
                  <div className="bar-track">
                    {cs != null && (
                      <div className="bar" style={{ width: `${(cs / maxCs) * 100}%`, background: projectRow ? "var(--accent)" : "#94a3b8" }} />
                    )}
                  </div>
                  <span className="bar-val">{cs == null ? "—" : formatCs(cs)}</span>
                  <span className="bar-meta muted small">{row.error ? row.error : direction?.governing ?? ""}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="muted small">The dropdown switches the plotted direction. Both directions are already calculated, so the switch does not call SkyCiv.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Spectral accelerations from SkyCiv</h2>
        <HazardBars rows={rows} project={projectClass} />
        <p className="legend">
          <span><i className="swatch sds" /> SDS</span>
          <span><i className="swatch sd1" /> SD1</span>
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Comparison table</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Site class</th>
              <th>SDS</th>
              <th>SD1</th>
              <th>S1</th>
              <th>TL</th>
              <th>SDC</th>
              <th>Cs</th>
              <th>Governing</th>
              <th>Base shear</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const direction = row.result?.directions[axis];
              return (
                <tr key={row.siteClass} className={row.siteClass === projectClass ? "project" : undefined}>
                  <td>{row.siteClass}</td>
                  <td className="num">{formatNum(row.sds, 3)}</td>
                  <td className="num">{formatNum(row.sd1, 3)}</td>
                  <td className="num">{formatNum(row.s1, 3)}</td>
                  <td className="num">{formatNum(row.tl, 2)}</td>
                  <td className="num">{row.result?.sdc || row.sdc || "—"}</td>
                  <td className={row.error ? "site-error" : "num"}>{row.error || (direction ? formatCs(direction.cs) : "—")}</td>
                  <td>{row.error ? "" : direction?.governing ?? "—"}</td>
                  <td className="num">{row.error ? "" : shear(direction)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function HazardBars({ rows, project }: { rows: SiteClassRow[]; project: string }) {
  const width = 680;
  const height = 220;
  const pad = { l: 40, r: 8, t: 16, b: 28 };
  const maxY = Math.max(0.05, ...rows.map((row) => Math.max(row.sds ?? 0, row.sd1 ?? 0))) * 1.08;
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const slot = plotW / Math.max(rows.length, 1);
  const yOf = (value: number) => pad.t + plotH * (1 - value / maxY);
  const barW = Math.min(16, slot * 0.28);
  return (
    <figure className="spectrum-card">
      <svg viewBox={`0 0 ${width} ${height}`} className="spectrum spectrum-tall" role="img" aria-label="SDS and SD1 by site class">
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} stroke="#e2e8f0" />
        <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#e2e8f0" />
        <text x={4} y={14} className="spectrum-label">{maxY.toFixed(2)}</text>
        {rows.map((row, index) => {
          const center = pad.l + slot * index + slot / 2;
          return (
            <g key={row.siteClass}>
              {row.sds != null && (
                <rect x={center - barW - 1} y={yOf(row.sds)} width={barW} height={height - pad.b - yOf(row.sds)} fill="#1d4ed8" />
              )}
              {row.sd1 != null && (
                <rect x={center + 1} y={yOf(row.sd1)} width={barW} height={height - pad.b - yOf(row.sd1)} fill="#94a3b8" />
              )}
              <text x={center} y={height - 8} textAnchor="middle" className="spectrum-label" fontWeight={row.siteClass === project ? 700 : 400}>
                {row.siteClass}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function extreme(points: { siteClass: string; cs: number }[], which: "high" | "low"): { cs: number; classes: string } | null {
  if (!points.length) return null;
  const target = which === "high" ? Math.max(...points.map((point) => point.cs)) : Math.min(...points.map((point) => point.cs));
  const classes = points.filter((point) => Math.abs(point.cs - target) < 1e-9).map((point) => point.siteClass);
  return { cs: target, classes: classes.join(", ") };
}

function formatCs(value: number): string {
  return value.toFixed(5);
}

function formatNum(value: number | null, digits: number): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function shear(direction: DirectionCs | undefined): string {
  if (!direction) return "—";
  if (direction.base_shear_kips == null) return direction.symbolic_base_shear;
  return `${direction.base_shear_kips.toLocaleString(undefined, { maximumFractionDigits: 1 })} kips`;
}
