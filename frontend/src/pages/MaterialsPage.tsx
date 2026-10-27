import { useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useLtl } from '../ltl/store';
import { fmtIn } from '../ltl/calc';
import { MaterialModal, WireframeNote } from '../ltl/ui';

export default function MaterialsPage() {
  const { materials: all, materialsSource, updateMaterial, removeMaterial } = useLtl();
  // the page shows the materials DB; the Demo's own samples appear only when the DB is offline
  const materials = materialsSource === 'db' ? all.filter((m) => !m.demo) : all;
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = materials.filter((m) => `${m.name} ${m.category}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Materials DB</h1>
      </header>
      {materialsSource === 'db' ? (
        <WireframeNote>Kim's dead load spreadsheet, stored in the database. Edits and added materials are saved. Layer matching for uploaded IFC models reads these rows.</WireframeNote>
      ) : (
        <WireframeNote>{materialsSource === 'loading' ? 'Loading the materials database…' : 'Materials API offline: showing the Demo samples. Changes live in this browser session only and reset on reload.'}</WireframeNote>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Material database</h2>
            <p className="muted">{materials.length} materials. Typical values; verify against ASCE 7 Table C3.1-1 before design use.</p>
          </div>
          <div className="row-gap">
            <label className="search">
              <Search size={14} />
              <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add material</button>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Category</th>
              <th>Orientation</th>
              <th>Source</th>
              <th>Basis</th>
              <th className="num">Unit weight</th>
              <th>Thicknesses</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>{m.name}{m.custom && <span className="tag">custom</span>}</td>
                <td className="muted">{m.category}</td>
                <td className="muted">{m.orientation || '—'}</td>
                <td className="muted small">{m.source || '—'}</td>
                <td className="muted">{m.basis}</td>
                <td className="num">
                  <input
                    className="num-input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={m.unitWeight}
                    onChange={(e) => updateMaterial(m.id, { unitWeight: Number(e.target.value) })}
                    aria-label={`${m.name} unit weight`}
                  />{' '}
                  <span className="muted small">{m.basis.toLowerCase()}</span>
                </td>
                <td className="muted">{m.thicknesses.map(fmtIn).join(', ')}{m.psfByThickness ? ' (psf listed per thickness)' : ''}</td>
                <td>
                  {m.custom && (
                    <button className="icon-btn danger" aria-label={`Delete ${m.name}`} onClick={() => removeMaterial(m.id)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {adding && <MaterialModal onClose={() => setAdding(false)} />}
    </div>
  );
}
