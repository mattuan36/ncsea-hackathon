import { useState } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useLtl } from '../ltl/store';
import { assemblyPsf, basisLabel, calcPsf, fmt, fmtIn, layerPsf, levelTakeoff } from '../ltl/calc';
import AssemblyGraphic from '../ltl/AssemblyGraphic';
import PlanView from '../ltl/PlanView';
import { ComparisonDashboard } from '../lateral/SiteClassStep';
import ReportView from '../lateral/ReportView';
import type { CsReportData } from '../lateral/csReport';
import { csDisplayFromParts, csFormulas, deadLoadFormulas, FormulaList } from '../math/Equation';
import { WireframeNote } from '../ltl/ui';

export default function ReportsPage() {
  const [tab, setTab] = useState<'graphic' | 'sheet' | 'hazard' | 'shear'>('graphic');
  return (
    <div className="page page-scroll">
      <header className="page-header row-between">
        <div>
          <h1>Reports</h1>
          <p className="muted subtitle">Dead load sheets, the site hazard report, and the lateral base shear report.</p>
        </div>
        <div className="row-gap no-print">
          <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
          <button className="btn" disabled title="Not wired in the wireframe yet"><FileSpreadsheet size={16} /> Export .xlsx</button>
        </div>
      </header>
      <div className="tabs no-print">
        <button className={tab === 'graphic' ? 'on' : ''} onClick={() => setTab('graphic')}>1 · Graphical output</button>
        <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>2 · Spreadsheet</button>
        <button className={tab === 'hazard' ? 'on' : ''} onClick={() => setTab('hazard')}>3 · Hazard</button>
        <button className={tab === 'shear' ? 'on' : ''} onClick={() => setTab('shear')}>4 · Base shear</button>
      </div>
      {tab === 'graphic' && <GraphicSheets />}
      {tab === 'sheet' && <Spreadsheet />}
      {tab === 'hazard' && <HazardReport />}
      {tab === 'shear' && <BaseShearReport />}
    </div>
  );
}

function TitleBlock({ subtitle, kind = 'Dead load takeoff' }: { subtitle: string; kind?: string }) {
  const { projectName, model } = useLtl();
  return (
    <div className="title-block">
      <div>
        <strong>LightenTheLoad</strong>
        <span className="muted"> · {kind}</span>
      </div>
      <div>{projectName}</div>
      <div className="muted">{subtitle}</div>
      <div className="muted">Source: {model?.label ?? 'Demo · sample model'}</div>
      <div className="muted">{new Date().toLocaleDateString()}</div>
    </div>
  );
}

function GraphicSheets() {
  const { plan, isDemo } = useLtl();
  return (
    <>
      {plan.levels.filter((l) => !l.minor).map((l, i) => (
        <section key={l.id} className="sheet">
          <TitleBlock subtitle={`Sheet ${isDemo ? l.id : `S-${i + 1}`} — ${l.name}`} />
          <PlanView initialLevel={l.id} showLevelTabs={false} />
        </section>
      ))}
    </>
  );
}

function Spreadsheet() {
  const { types, materials, plan } = useLtl();
  const governing = types.filter((t) => t.include && !t.parentId);
  const qtyByGov = new Map<string, { qty: number; kips: number }>();
  plan.levels.forEach((lvl) =>
    levelTakeoff(lvl, types, materials).forEach((e) => {
      const cur = qtyByGov.get(e.govId) ?? { qty: 0, kips: 0 };
      qtyByGov.set(e.govId, { qty: cur.qty + e.qty, kips: cur.kips + e.kips });
    }),
  );

  return (
    <section className="sheet">
      <TitleBlock subtitle="Assembly breakdown (spreadsheet layout)" />
      <WireframeNote>Preview of the .xlsx layout: one block per assembly with its section graphic and layer breakdown. Quantities are from the plan levels shown in the graphical output.</WireframeNote>
      <FormulaList formulas={deadLoadFormulas(types.some((t) => t.netArea != null))} />
      <div className="xls">
        <div className="xls-head">
          <span>Section</span>
          <span>Layer / material</span>
          <span>Thickness</span>
          <span>Unit wt</span>
          <span>Calc PSF</span>
          <span>Used PSF</span>
          <span>Quantity</span>
          <span>Kips</span>
        </div>
        {governing.map((t) => {
          const q = qtyByGov.get(t.id);
          const subs = types.filter((x) => x.parentId === t.id);
          return (
            <div key={t.id} className="xls-block">
              <div className="xls-title">
                <span><span className="swatch" style={{ background: t.color }} /> {t.assemblyName}</span>
                <span className="muted small">{t.name}{subs.length ? ` + ${subs.map((s) => s.assemblyName).join(', ')}` : ''}</span>
              </div>
              <div className="xls-body">
                <div className="xls-graphic"><AssemblyGraphic kind={t.kind} layers={t.layers} compact /></div>
                <div className="xls-rows">
                  {t.layers.map((l, i) => {
                    const m = materials.find((x) => x.id === l.materialId);
                    return (
                      <div key={l.id} className="xls-row">
                        <span>{i + 1}. {m?.name}</span>
                        <span>{fmtIn(l.thickness)}</span>
                        <span>{m ? basisLabel(m) : ''}</span>
                        <span className="num">{fmt(calcPsf(m, l.thickness), 1)}</span>
                        <span className={`num${l.overridePsf != null ? ' overridden' : ''}`}>{fmt(layerPsf(l, materials), 1)}</span>
                        <span />
                        <span />
                      </div>
                    );
                  })}
                  <div className="xls-row total">
                    <span>Total {t.kind === 'wall' ? `(height ${t.height}'${t.netArea != null ? `, net ${fmt(t.netArea)} SF` : ''})` : ''}</span>
                    <span />
                    <span />
                    <span />
                    <span className="num">{fmt(assemblyPsf(t.layers, materials), 1)}</span>
                    <span className="num">{q ? `${fmt(q.qty)} ${t.kind === 'floor' ? 'SF' : 'LF'}` : '—'}</span>
                    <span className="num">{q ? fmt(q.kips, 1) : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HazardReport() {
  const { hazardReport } = useLtl();
  return (
    <section className="sheet">
      <TitleBlock subtitle="Hazard report" kind="Site hazard" />
      {hazardReport ? (
        <ReportView report={hazardReport} />
      ) : (
        <p className="muted">No hazard report yet. Generate a SkyCiv report on Lateral, or load the sample.</p>
      )}
    </section>
  );
}

function BaseShearReport() {
  const { baseShearReport, siteClassComparison } = useLtl();
  const [axis, setAxis] = useState<'X' | 'Y'>('X');
  return (
    <section className="sheet">
      <TitleBlock subtitle="Lateral base shear" kind="ASCE 7-22 ELF" />
      {baseShearReport ? <ShearBody data={baseShearReport} /> : (
        <>
          <p className="muted">No base shear report yet. Calculate Cs on Lateral. The equations below are the ones that sheet will evaluate.</p>
          <FormulaList formulas={csFormulas(null)} />
        </>
      )}
      <h2 className="card-title">Site class comparison</h2>
      {siteClassComparison && siteClassComparison.rows.length > 0 ? (
        <>
          <p className="muted">
            Cs for risk category {siteClassComparison.risk || '—'} across site classes. Direction {axis} is plotted.
          </p>
          <div className="form-grid no-print">
            <label className="span-2">
              Structural system
              <select value={axis} onChange={(event) => setAxis(event.target.value as 'X' | 'Y')}>
                <option value="X">Direction X{directionLabel(baseShearReport, 'X')}</option>
                <option value="Y">Direction Y{directionLabel(baseShearReport, 'Y')}</option>
              </select>
            </label>
          </div>
          <ComparisonDashboard rows={siteClassComparison.rows} axis={axis} projectClass={siteClassComparison.projectClass} />
        </>
      ) : (
        <p className="muted">The site class comparison appears here after it is run on Lateral.</p>
      )}
    </section>
  );
}

function directionLabel(data: CsReportData | null, axis: 'X' | 'Y'): string {
  const direction = data?.directions.find((item) => item.axis === axis);
  if (!direction) return '';
  const systems = direction.systemIds.map((id, index) => `${id} ${direction.systemNames[index] ?? ''}`.trim()).join(' + ');
  return systems ? ` · ${systems}` : '';
}

function ShearBody({ data }: { data: CsReportData }) {
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Risk category</span><strong>{data.risk || '—'}</strong></div>
        <div className="kpi"><span>Site class</span><strong>{data.siteClass || '—'}</strong></div>
        <div className="kpi"><span>SDC</span><strong>{data.sdc}</strong><span>{data.sdcBasis}</span></div>
        <div className="kpi"><span>Ie</span><strong>{data.ie}</strong></div>
      </div>
      <table className="data-table">
        <tbody>
          <tr><td>Source</td><td>{data.source || '—'}</td></tr>
          <tr><td>SDS / SD1 / S1</td><td className="num">{data.sds || '—'} / {data.sd1 || '—'} / {data.s1 || '—'}</td></tr>
          <tr><td>TL</td><td className="num">{data.tl ? `${data.tl} s` : '—'}</td></tr>
          <tr><td>Reported SDC</td><td className="num">{data.reportedSdc || '—'}</td></tr>
          <tr><td>hn</td><td className="num">{data.hn ? `${data.hn} ft` : '—'}</td></tr>
          <tr><td>Stories above base</td><td className="num">{data.stories || '—'}</td></tr>
          <tr><td>W</td><td className="num">{data.weight ? `${data.weight} kips` : 'Not supplied'}</td></tr>
          <tr><td>Cu</td><td className="num">{data.cu.toFixed(3)}</td></tr>
        </tbody>
      </table>
      <div className="two-col">
        {data.directions.map((direction) => (
          <div key={direction.axis}>
            <h3 className="card-title">Direction {direction.axis}</h3>
            <div className="kpis">
              <div className="kpi"><span>Cs</span><strong>{direction.cs.toFixed(5)}</strong><span>{direction.governing}</span></div>
              <div className="kpi"><span>Base shear</span><strong>{direction.baseShear}</strong></div>
            </div>
            <FormulaList formulas={csFormulas(csDisplayFromParts({
              sds: direction.sdsUsed,
              sd1: Number(data.sd1),
              s1: Number(data.s1),
              tl: Number(data.tl),
              r: direction.r,
              ie: data.ie,
              t: direction.tUsed,
              cs: direction.cs,
              governing: direction.governing,
              weight: data.weight.trim() ? Number(data.weight) : null,
              ta: direction.ta,
              cuTa: direction.cuTa,
            }))} />
            <table className="data-table">
              <tbody>
                <tr><td>Lateral system</td><td>{direction.systemIds.map((id, index) => `${id} ${direction.systemNames[index] ?? ''}`.trim()).join('; ') || '—'}</td></tr>
                <tr><td>R / Omega0 / Cd</td><td className="num">{direction.r} / {direction.omega0} / {direction.cd}</td></tr>
                <tr><td>Period used</td><td className="num">{direction.tUsed.toFixed(3)} s</td></tr>
                <tr><td>Period basis</td><td>{direction.tBasis}</td></tr>
                <tr><td>SDS used for Cs</td><td className="num">{direction.sdsUsed.toFixed(3)}</td></tr>
                <tr><td>Height limit</td><td>{direction.limit || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {data.warnings.map((warning) => <p className="banner warn" key={warning}>{warning}</p>)}
      {data.notes.map((note) => <p className="banner info" key={note}>{note}</p>)}
    </>
  );
}
