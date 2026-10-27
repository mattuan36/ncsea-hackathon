import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLtl } from '../ltl/store';
import { LEVELS } from '../ltl/data';
import { assemblyPsf, fmt, levelTakeoff } from '../ltl/calc';

export default function AnalyticsPage() {
  const { types, materials, model } = useLtl();

  const { rows, floorSF, wallLF, kips } = useMemo(() => {
    const agg = new Map<string, { kips: number; qty: number }>();
    LEVELS.forEach((l) =>
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
      floorSF: rows.filter((r) => r.t.kind === 'floor').reduce((s, r) => s + r.qty, 0),
      wallLF: rows.filter((r) => r.t.kind === 'wall').reduce((s, r) => s + r.qty, 0),
      kips: rows.reduce((s, r) => s + r.kips, 0),
    };
  }, [types, materials]);

  const included = types.filter((t) => t.include);
  const reviewed = included.filter((t) => t.status === 'done' || t.status === 'merged').length;
  const verified = included.filter((t) => t.materialVerified).length;
  const max = Math.max(...rows.map((r) => r.kips), 1);

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Analytics</h1>
        <p className="muted subtitle">
          Takeoff summary across {LEVELS.length} plan levels{model ? ` · ${model.label}` : ' · sample model'}.
        </p>
      </header>

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
                {fmt(assemblyPsf(r.t.layers, materials), 1)} psf · {fmt(r.qty)} {r.t.kind === 'floor' ? 'SF' : 'LF'}
              </span>
            </div>
          ))}
        </div>
        <p className="muted small">
          Walls: psf × height × length. Full breakdown in <Link className="link" to="/reports">Reports</Link>.
        </p>
      </section>
    </div>
  );
}
