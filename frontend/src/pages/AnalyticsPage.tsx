import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { useLtl } from '../ltl/store';
import { deadLoadFormulas, FormulaList } from '../math/Equation';
import { assemblyPsf, effectiveLayers, fmt, levelFloorArea, levelTakeoff } from '../ltl/calc';
import IfcViewer from '../ifc/IfcViewer';

export default function AnalyticsPage() {
  const { types, materials, model, plan, isDemo, ifc, ifcStatus, ifcError, loadIfcFile, startUpload, job, error } = useLtl();
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = job != null && job.status !== 'failed';

  const importIfc = async (file: File | undefined) => {
    if (!file) return;
    if (/\.ifc$/i.test(file.name)) await loadIfcFile(file);
    await startUpload(file);
  };

  const { rows, floorSF, wallLF, kips } = useMemo(() => {
    const agg = new Map<string, { kips: number; qty: number }>();
    plan.levels.forEach((l) =>
      levelTakeoff(l, types, materials).forEach((e) => {
        const cur = agg.get(e.govId) ?? { kips: 0, qty: 0 };
        agg.set(e.govId, { kips: cur.kips + e.kips, qty: cur.qty + e.qty });
      }),
    );
    const rows = [...agg.entries()]
      .map(([id, v]) => ({ t: types.find((x) => x.id === id)!, ...v }))
      .sort((a, b) => b.kips - a.kips);
    return {
      rows,
      floorSF: plan.levels.reduce((s, l) => s + levelFloorArea(l, types), 0),
      wallLF: rows.filter((r) => r.t.kind === 'wall').reduce((s, r) => s + r.qty, 0),
      kips: rows.reduce((s, r) => s + r.kips, 0),
    };
  }, [types, materials, plan]);

  const included = types.filter((t) => t.include);
  const reviewed = included.filter((t) => t.status === 'done' || t.status === 'merged').length;
  const verified = included.filter((t) => t.materialVerified).length;
  const max = Math.max(...rows.map((r) => r.kips), 1);

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Analytics</h1>
        <p className="muted subtitle">
          Takeoff summary across {plan.levels.length} plan levels{model ? ` · ${model.label}` : ' · Demo sample model'}.
        </p>
      </header>

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Model</h2>
            <p className="muted">{ifc ? ifc.name : 'Import an IFC exported from Revit. It is stored with the project and read for Gravity, Analytics, and Reports.'}</p>
          </div>
          <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} /> Import IFC</button>
          <input
            ref={fileInput}
            type="file"
            accept=".ifc"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              void importIfc(file);
              event.target.value = '';
            }}
          />
        </div>
        {error && <div className="banner error">{error}</div>}
        {job?.status === 'failed' && job.error && <div className="banner error">{job.error}</div>}
        {busy && (
          <>
            <p className="muted small">{job.stage}{job.id ? ` · ${Math.round(job.progress * 100)}%` : ''}</p>
            <div className="progress" aria-hidden="true"><div style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} /></div>
          </>
        )}
        <IfcViewer data={ifcStatus === 'ready' ? ifc?.data ?? null : null} status={ifcStatus} error={ifcError} />
        <p className="muted small ifc-hint">Drag to orbit. Scroll to zoom. Floor and wall types fill in after the model has been read.</p>
      </section>

      <div className="kpis">
        <div className="kpi"><span>Total dead load</span><strong>{fmt(kips, 1)} kips</strong></div>
        <div className="kpi"><span>Floor area</span><strong>{fmt(floorSF)} SF</strong></div>
        <div className="kpi"><span>Wall length</span><strong>{fmt(wallLF)} LF</strong></div>
        <div className="kpi"><span>Types reviewed</span><strong>{reviewed} / {included.length}</strong></div>
        <div className="kpi"><span>Materials verified</span><strong>{verified} / {included.length}</strong></div>
      </div>

      <section className="card">
        <h2 className="card-title">Dead load by assembly</h2>
        <div className="bars">
          {rows.map((r) => (
            <div key={r.t.id} className="bar-row">
              <span className="bar-label">{r.t.assemblyName}</span>
              <div className="bar-track">
                <div className="bar" style={{ width: `${(r.kips / max) * 100}%`, background: r.t.color }} />
              </div>
              <span className="bar-val">{fmt(r.kips, 1)} k</span>
              <span className="bar-meta muted small">
                {fmt(assemblyPsf(effectiveLayers(r.t, types), materials), 1)} psf · {fmt(r.qty)} {r.t.kind === 'floor' ? 'SF' : 'LF'}
              </span>
            </div>
          ))}
        </div>
        <FormulaList formulas={deadLoadFormulas(!isDemo)} />
        <p className="muted small">
          Full breakdown in <Link className="link" to="/reports">Reports</Link>.
        </p>
      </section>
    </div>
  );
}
