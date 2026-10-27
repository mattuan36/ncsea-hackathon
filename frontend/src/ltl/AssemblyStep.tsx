import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, GitMerge, Plus, SkipForward, Trash2, Undo2 } from 'lucide-react';
import { STRUCTURAL_MATERIALS, uid, type ElementType, type Layer } from './data';
import { assemblyPsf, basisLabel, calcPsf, fmt, fmtIn, totalThickness } from './calc';
import { useLtl } from './store';
import { MaterialModal, MaterialPicker, Modal } from './ui';
import AssemblyGraphic from './AssemblyGraphic';

/** Walk order: floors then walls, grouped by the structural material read from Revit. */
function walkOrder(types: ElementType[]) {
  return types
    .filter((t) => t.include)
    .sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'floor' ? -1 : 1
        : a.revitMaterial.localeCompare(b.revitMaterial) || a.name.localeCompare(b.name),
    );
}

/** Most similar included type of the same kind and Revit structural material, by total thickness. */
function mostSimilar(t: ElementType, types: ElementType[]) {
  const candidates = types.filter((x) => x.id !== t.id && x.include && x.kind === t.kind && x.revitMaterial === t.revitMaterial && x.parentId !== t.id);
  const mine = totalThickness(t.layers);
  return candidates.sort((a, b) => Math.abs(totalThickness(a.layers) - mine) - Math.abs(totalThickness(b.layers) - mine))[0];
}

export default function AssemblyStep({ onDone }: { onDone: () => void }) {
  const { types, materials, updateType, copyLayers, mergeTypes, unmerge } = useLtl();
  const queue = useMemo(() => walkOrder(types), [types]);
  const [currentId, setCurrentId] = useState(queue[0]?.id);
  const [newMaterialFor, setNewMaterialFor] = useState<{ layerId: string; name: string } | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');

  const t = queue.find((x) => x.id === currentId) ?? queue[0];
  if (!t) return <div className="card">No types are included. Go back and include at least one floor or wall type.</div>;

  const idx = queue.indexOf(t);
  const sameKind = queue.filter((x) => x.kind === t.kind);
  const parent = t.parentId ? types.find((x) => x.id === t.parentId) : undefined;
  const similar = mostSimilar(t, types);
  const layers = t.layers;
  const psf = assemblyPsf(parent ? parent.layers : layers, materials);
  const others = queue.filter((x) => x.id !== t.id && x.kind === t.kind && !x.parentId);

  const setLayers = (next: Layer[]) => updateType(t.id, { layers: next });
  const patchLayer = (id: string, patch: Partial<Layer>) => setLayers(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const goTo = (i: number) => {
    const next = queue[i];
    if (next) {
      setCurrentId(next.id);
      setCopyFrom('');
    } else onDone();
  };

  let lastGroup = '';
  return (
    <div className="walk">
      <aside className="walk-rail card">
        {queue.map((x) => {
          const group = `${x.kind === 'floor' ? 'Floors' : 'Walls'} · ${x.revitMaterial}`;
          const header = group !== lastGroup;
          lastGroup = group;
          return (
            <div key={x.id}>
              {header && <div className="rail-group">{group}</div>}
              <button className={`rail-item${x.id === t.id ? ' current' : ''}`} onClick={() => goTo(queue.indexOf(x))}>
                <span className={`dot ${x.status}`} />
                <span className="rail-name">{x.assemblyName}</span>
                {x.parentId && <GitMerge size={13} className="muted" />}
              </button>
            </div>
          );
        })}
      </aside>

      <section className="walk-main">
        <div className="card">
          <div className="card-head">
            <div>
              <p className="eyebrow">
                {t.kind === 'floor' ? 'Floor' : 'Wall'} type {sameKind.indexOf(t) + 1} of {sameKind.length} · structural material group “{t.revitMaterial}”
              </p>
              <h2 className="type-title"><span className="swatch" style={{ background: t.color }} /> {t.name}</h2>
              <p className="muted">
                {t.instances} instances · {fmt(t.modelQty)} {t.kind === 'floor' ? 'SF' : 'LF'}
                {t.height ? ` · ${t.height}' tall` : ''}
              </p>
            </div>
            <label className="field inline">
              Assembly name
              <input value={t.assemblyName} onChange={(e) => updateType(t.id, { assemblyName: e.target.value })} />
            </label>
          </div>

          {similar && !parent && (
            <div className="banner info">
              <span>
                Most similar: <strong>{similar.name}</strong> — same structural material, total thickness{' '}
                {fmtIn(totalThickness(similar.layers))} vs {fmtIn(totalThickness(layers))}.
              </span>
              <button className="btn small" onClick={() => setMergeOpen(true)}><GitMerge size={14} /> Merge…</button>
            </div>
          )}

          <div className={`verify${t.materialVerified ? ' ok' : ''}`}>
            <span>Structural material</span>
            <select
              value={t.structuralMaterial}
              onChange={(e) => updateType(t.id, { structuralMaterial: e.target.value, materialVerified: false })}
            >
              {STRUCTURAL_MATERIALS.map((m) => <option key={m}>{m}</option>)}
            </select>
            {t.structuralMaterial !== t.revitMaterial && <span className="muted small">Revit says “{t.revitMaterial}”</span>}
            {t.materialVerified ? (
              <span className="ok-line"><Check size={14} /> Verified by engineer</span>
            ) : (
              <button className="btn small" onClick={() => updateType(t.id, { materialVerified: true })}>Confirm material is correct</button>
            )}
          </div>
        </div>

        {parent ? (
          <div className="card">
            <div className="banner info">
              <span>
                Merged as a sub-assembly of <strong>{parent.assemblyName}</strong>, which governs. Its layers ({fmt(psf, 1)} psf) apply to this type.
              </span>
              <button className="btn small" onClick={() => unmerge(t.id)}><Undo2 size={14} /> Unmerge</button>
            </div>
            <AssemblyGraphic kind={t.kind} layers={parent.layers} />
          </div>
        ) : (
          <div className="build">
            <div className="card build-graphic">
              <h3 className="section-label">Section</h3>
              <AssemblyGraphic kind={t.kind} layers={layers} />
            </div>
            <div className="card build-table">
              <h3 className="section-label">Layers {t.kind === 'floor' ? '(top to bottom)' : '(exterior to interior)'}</h3>
              <table className="data-table layers">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Material</th>
                    <th>Thickness</th>
                    <th className="num">Basis</th>
                    <th className="num">PSF</th>
                    <th className="num">Override</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {layers.map((l, i) => {
                    const m = materials.find((x) => x.id === l.materialId);
                    const calc = calcPsf(m, l.thickness);
                    return (
                      <tr key={l.id}>
                        <td className="muted">{i + 1}</td>
                        <td>
                          <MaterialPicker
                            value={l.materialId}
                            onChange={(id) => {
                              const nm = materials.find((x) => x.id === id);
                              const thk = nm && !nm.thicknesses.includes(l.thickness) ? nm.thicknesses[0] : l.thickness;
                              patchLayer(l.id, { materialId: id, thickness: thk, overridePsf: null });
                            }}
                            onCreate={(name) => setNewMaterialFor({ layerId: l.id, name })}
                          />
                        </td>
                        <td>
                          <select value={l.thickness} onChange={(e) => patchLayer(l.id, { thickness: Number(e.target.value) })} aria-label="Thickness">
                            {(m?.thicknesses ?? [l.thickness]).map((th) => <option key={th} value={th}>{fmtIn(th)}</option>)}
                          </select>
                        </td>
                        <td className="num muted small">{m ? basisLabel(m) : '—'}</td>
                        <td className={`num${l.overridePsf != null ? ' struck' : ''}`}>{fmt(calc, 1)}</td>
                        <td className="num">
                          <input
                            className={`num-input${l.overridePsf != null ? ' overridden' : ''}`}
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="—"
                            value={l.overridePsf ?? ''}
                            onChange={(e) => patchLayer(l.id, { overridePsf: e.target.value === '' ? null : Number(e.target.value) })}
                            aria-label="Override PSF"
                          />
                        </td>
                        <td>
                          <button className="icon-btn danger" aria-label="Remove layer" onClick={() => setLayers(layers.filter((x) => x.id !== l.id))}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>
                      <button className="btn small" onClick={() => setLayers([...layers, { id: uid('l'), materialId: 'nwc', thickness: 4, overridePsf: null }])}>
                        <Plus size={14} /> Add layer
                      </button>{' '}
                      <button className="btn small" onClick={() => setNewMaterialFor({ layerId: '', name: '' })}>
                        <Plus size={14} /> New material
                      </button>
                    </td>
                    <td className="num total" colSpan={2}>{fmt(psf, 1)} psf</td>
                    <td />
                  </tr>
                </tfoot>
              </table>

              <div className="reuse">
                <h3 className="section-label">Already built a similar type?</h3>
                <div className="row-gap">
                  <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="Copy from assembly">
                    <option value="">Copy layers from…</option>
                    {others.map((o) => <option key={o.id} value={o.id}>{o.assemblyName} ({fmt(assemblyPsf(o.layers, materials), 1)} psf)</option>)}
                  </select>
                  <button className="btn small" disabled={!copyFrom} onClick={() => copyLayers(copyFrom, t.id)}><Copy size={14} /> Copy</button>
                  <span className="muted small">or</span>
                  <button className="btn small" onClick={() => setMergeOpen(true)}><GitMerge size={14} /> Merge as sub-assembly…</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="step-footer">
          <button className="btn" onClick={() => goTo(idx - 1)} disabled={idx === 0}><ArrowLeft size={16} /> Previous</button>
          <div className="row-gap">
            <span className="muted small">{idx + 1} / {queue.length}</span>
            <button
              className="btn"
              onClick={() => {
                if (!t.parentId) updateType(t.id, { status: 'skipped' });
                goTo(idx + 1);
              }}
            >
              <SkipForward size={16} /> Skip
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (!t.parentId) updateType(t.id, { status: 'done' });
                goTo(idx + 1);
              }}
            >
              {idx === queue.length - 1 ? 'Finish → plan view' : 'Save & next'} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {newMaterialFor && (
        <MaterialModal
          initialName={newMaterialFor.name}
          onClose={() => setNewMaterialFor(null)}
          onSaved={(m) => {
            if (newMaterialFor.layerId) patchLayer(newMaterialFor.layerId, { materialId: m.id, thickness: m.thicknesses[0], overridePsf: null });
          }}
        />
      )}
      {mergeOpen && (
        <MergeDialog
          current={t}
          options={others}
          defaultTarget={similar && !similar.parentId ? similar.id : others[0]?.id}
          onClose={() => setMergeOpen(false)}
          onMerge={(target, governing) => {
            mergeTypes(t.id, target, governing);
            setMergeOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MergeDialog({ current, options, defaultTarget, onClose, onMerge }: {
  current: ElementType;
  options: ElementType[];
  defaultTarget?: string;
  onClose: () => void;
  onMerge: (targetId: string, governingId: string) => void;
}) {
  const { materials } = useLtl();
  const [target, setTarget] = useState(defaultTarget ?? '');
  const [governing, setGoverning] = useState(defaultTarget ?? '');
  const targetType = options.find((o) => o.id === target);
  return (
    <Modal
      title="Merge into another assembly"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!target || !governing} onClick={() => onMerge(target, governing)}>Merge</button>
        </>
      }
    >
      <p className="muted">The two types share one set of layers. The governing assembly’s layers apply; the other is listed under it as a sub-assembly.</p>
      <label className="field">
        Merge with
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setGoverning(e.target.value);
          }}
        >
          {options.map((o) => <option key={o.id} value={o.id}>{o.assemblyName}</option>)}
        </select>
      </label>
      {targetType && (
        <fieldset className="radio-group">
          <legend>Which assembly governs?</legend>
          {[targetType, current].map((o) => (
            <label key={o.id}>
              <input type="radio" name="gov" checked={governing === o.id} onChange={() => setGoverning(o.id)} />
              {o.assemblyName} <span className="muted small">({fmt(assemblyPsf(o.layers, materials), 1)} psf)</span>
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
