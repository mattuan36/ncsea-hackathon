import { useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useLtl } from '../ltl/store';
import { fmtIn } from '../ltl/calc';
import { MaterialModal, WireframeNote } from '../ltl/ui';

export default function SettingsPage() {
  const { projectName, setProjectName, model, materials, updateMaterial, removeMaterial } = useLtl();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = materials.filter((m) => `${m.name} ${m.category}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      <WireframeNote>Wireframe: changes here live in the browser session only and reset on reload.</WireframeNote>

      <section className="card">
        <h2 className="card-title">Project</h2>
        <div className="form-grid">
          <label>
            Project name
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </label>
          <label>
            Units
            <select disabled value="imperial"><option value="imperial">Imperial (psf, pcf, SF, LF)</option></select>
          </label>
          <label className="span-2">
            Model source
            <input readOnly value={model ? `${model.kind === 'ifc' ? 'IFC' : 'Revit'} — ${model.label}` : 'Not selected (choose one in Gravity › Model)'} />
          </label>
        </div>
      </section>

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
