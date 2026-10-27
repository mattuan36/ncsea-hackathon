import { useState } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useLtl } from '../ltl/store';
import { assemblyPsf, basisLabel, calcPsf, fmt, fmtIn, layerPsf, levelTakeoff } from '../ltl/calc';
import AssemblyGraphic from '../ltl/AssemblyGraphic';
import PlanView from '../ltl/PlanView';
import { WireframeNote } from '../ltl/ui';

export default function ReportsPage() {
  const [tab, setTab] = useState<'graphic' | 'sheet'>('graphic');
  return (
    <div className="page page-scroll">
      <header className="page-header row-between">
        <div>
          <h1>Reports</h1>
          <p className="muted subtitle">Output formats for the dead load takeoff.</p>
        </div>
        <div className="row-gap no-print">
          <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
          <button className="btn" disabled title="Not wired in the wireframe yet"><FileSpreadsheet size={16} /> Export .xlsx</button>
        </div>
      </header>
      <div className="tabs no-print">
        <button className={tab === 'graphic' ? 'on' : ''} onClick={() => setTab('graphic')}>1 · Graphical output</button>
        <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>2 · Spreadsheet</button>
      </div>
      {tab === 'graphic' ? <GraphicSheets /> : <Spreadsheet />}
    </div>
  );
}

function TitleBlock({ subtitle }: { subtitle: string }) {
  const { projectName, model } = useLtl();
  return (
    <div className="title-block">
      <div>
        <strong>LightenTheLoad</strong>
        <span className="muted"> · Dead load takeoff</span>
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
