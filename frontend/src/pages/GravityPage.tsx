import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Check, FileBox, Link2, Upload } from 'lucide-react';
import { fetchDocuments, fetchFolders, type DocumentRow } from '../api';
import { useLtl } from '../ltl/store';
import { assemblyPsf, effectiveLayers, fmt } from '../ltl/calc';
import type { Kind } from '../ltl/data';
import { WireframeNote } from '../ltl/ui';
import AssemblyStep from '../ltl/AssemblyStep';
import PlanView from '../ltl/PlanView';

const STEPS = ['Model', 'Floor types', 'Wall types', 'Build assemblies', 'Type table', 'Plan view'];

export default function GravityPage() {
  const { gravityStep: step, setGravityStep: setStep, model, isDemo, project, error } = useLtl();
  const go = (n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n)));

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Dead Load Takeoff</h1>
        <p className="muted subtitle">
          Build dead-load assemblies and design criteria from the model, step by step.
          {isDemo ? <span className="tag demo">Demo · sample data</span> : <span className="tag">{project.kind === 'model' ? project.filename : ''}</span>}
        </p>
      </header>

      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button onClick={() => go(i)} disabled={i > 0 && !model}>
              <span className="step-num">{i < step ? <Check size={13} /> : i + 1}</span>
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ol>

      {error && step > 0 && <div className="banner error">{error}</div>}
      {step === 0 && <ModelStep onNext={() => go(1)} />}
      {step === 1 && <FilterStep kind="floor" onBack={() => go(0)} onNext={() => go(2)} />}
      {step === 2 && <FilterStep kind="wall" onBack={() => go(1)} onNext={() => go(3)} />}
      {step === 3 && <AssemblyStep onDone={() => go(4)} />}
      {step === 4 && <TypeTableStep onBack={() => go(3)} onNext={() => go(5)} />}
      {step === 5 && (
        <div className="card fill">
          <PlanView />
        </div>
      )}
    </div>
  );
}

function StepFooter({ onBack, onNext, nextLabel = 'Next', nextDisabled }: { onBack?: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <div className="step-footer">
      {onBack ? <button className="btn" onClick={onBack}>Back</button> : <span />}
      <button className="btn primary" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>
    </div>
  );
}

function ModelStep({ onNext }: { onNext: () => void }) {
  const { model, setModel, project, models, job, startUpload, startFromDocument, openModel, openDemo, error: storeError } = useLtl();
  const [files, setFiles] = useState<DocumentRow[]>([]);
  const [path, setPath] = useState(model?.kind === 'revit' ? model.label : '');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = async () => {
    const folders = await fetchFolders();
    const root = folders.find((f) => f.parent_id === null);
    if (root) setFiles((await fetchDocuments(root.id)).filter((d) => /\.(ifc|ifczip|rvt)$/i.test(d.filename)));
  };

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [models.length]);

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setError(null);
    await startUpload(list[0]);
    load().catch(() => undefined);
  };

  const readyFor = (docId: number) => models.find((m) => m.document_id === docId && m.status === 'ready');
  const openDoc = (d: DocumentRow) => {
    const ready = readyFor(d.id);
    if (ready) openModel(ready.id);
    else if (/\.rvt$/i.test(d.filename)) setError('A .rvt file cannot be read: export the model to IFC from Revit and upload the .ifc.');
    else startFromDocument(d.id);
  };
  const activeDoc = project.kind === 'model' ? models.find((m) => m.id === project.id)?.document_id : undefined;
  const busy = job != null && job.status !== 'failed';

  return (
    <>
      <WireframeNote>IFC uploads are read from the model and saved, so they reopen after a reload. Pointing to a Revit model is still simulated: it opens the Demo sample project.</WireframeNote>
      {(error || storeError) && <div className="banner error">{error ?? storeError}</div>}

      <section className="card">
        <h2 className="card-title">Project</h2>
        <ul className="pick-list">
          <li>
            <label className={project.kind === 'demo' ? 'selected' : ''}>
              <input type="radio" name="project" checked={project.kind === 'demo'} onChange={openDemo} />
              <Box size={16} /> Demo · Riverside Office Building <span className="tag">sample data</span>
            </label>
          </li>
          {models.filter((m) => m.status === 'ready').map((m) => (
            <li key={m.id}>
              <label className={project.kind === 'model' && project.id === m.id ? 'selected' : ''}>
                <input type="radio" name="project" checked={project.kind === 'model' && project.id === m.id} onChange={() => openModel(m.id)} />
                <FileBox size={16} /> {m.settings.project_name ?? m.filename}
                <span className="muted small"> · {m.filename} · read {new Date(m.finished_at ?? m.created_at).toLocaleString()}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {job && (
        <section className={`card job${job.status === 'failed' ? ' failed' : ''}`} aria-live="polite">
          <div className="card-head">
            <h2 className="card-title"><FileBox size={18} /> Reading {job.filename}</h2>
            <span className="muted small">{fmt(job.size_bytes / 1e6, 1)} MB</span>
          </div>
          {job.status === 'failed' ? (
            <div className="banner error">
              <span>Could not read the model: {job.error}</span>
              {job.document_id != null && <button className="btn small" onClick={() => startFromDocument(job.document_id!)}>Try again</button>}
            </div>
          ) : (
            <>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
                <div style={{ width: `${Math.max(job.progress, 0.02) * 100}%` }} />
              </div>
              <p className="muted small">{job.stage} · {fmt(job.progress * 100)}%. Large models take a minute or two; you can leave this page.</p>
            </>
          )}
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <h2 className="card-title"><FileBox size={18} /> Upload an IFC model</h2>
          <p className="muted">IFC exported from Revit. Files are stored in Documents › 3D Models.</p>
          <ul className="pick-list">
            {files.map((f) => (
              <li key={f.id}>
                <label className={activeDoc === f.id ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="model"
                    checked={activeDoc === f.id}
                    disabled={busy}
                    onChange={() => openDoc(f)}
                  />
                  <Box size={16} /> {f.filename}
                  {!readyFor(f.id) && <span className="tag">not read yet</span>}
                </label>
              </li>
            ))}
            {files.length === 0 && <li className="muted small">No IFC files yet.</li>}
          </ul>
          <div className="row-gap">
            <button className="btn" disabled={busy} onClick={() => input.current?.click()}><Upload size={16} /> Upload IFC</button>
            <Link className="link" to="/documents">Open Documents</Link>
          </div>
          <input
            ref={input}
            type="file"
            accept=".ifc,.ifczip,.rvt"
            hidden
            onChange={(e) => {
              upload([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </section>

        <section className="card">
          <h2 className="card-title"><Link2 size={18} /> Point to a Revit model</h2>
          <p className="muted">A local .rvt path or a cloud model (ACC / BIM 360) link.</p>
          <label className="field">
            Model location
            <input placeholder="C:\\Projects\\Riverside\\Riverside_STR.rvt" value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={!path.trim()}
            onClick={() => {
              openDemo();
              setModel({ kind: 'revit', label: path.trim() });
            }}
          >
            Connect
          </button>
          {model?.kind === 'revit' && <p className="ok-line"><Check size={14} /> Connected to {model.label}</p>}
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">I want to build my…</h2>
        <div className="goal-row">
          <label className="goal selected"><input type="radio" checked readOnly /> Dead load takeoffs / design criteria</label>
          <label className="goal disabled"><input type="radio" disabled /> Lateral criteria (coming later)</label>
        </div>
      </section>

      <StepFooter onNext={onNext} nextDisabled={!model} nextLabel={model ? `Read ${model.kind === 'ifc' ? 'IFC' : 'Revit'} model` : 'Choose a model first'} />
    </>
  );
}

function FilterStep({ kind, onBack, onNext }: { kind: Kind; onBack: () => void; onNext: () => void }) {
  const { types, updateType } = useLtl();
  const [hideUnused, setHideUnused] = useState(true);
  const all = types.filter((t) => t.kind === kind).sort((a, b) => a.revitMaterial.localeCompare(b.revitMaterial) || a.name.localeCompare(b.name));
  const unused = all.filter((t) => t.instances === 0);
  const shown = hideUnused ? all.filter((t) => t.instances > 0) : all;
  const unit = kind === 'floor' ? 'SF' : 'LF';
  const noun = kind === 'floor' ? 'floor' : 'wall';

  let lastMat = '';
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Filter {noun} types by instances</h2>
            <p className="muted">
              {all.length} {noun} types in the model · {unused.length} have no instances and are filtered out.
            </p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={hideUnused} onChange={(e) => setHideUnused(e.target.checked)} />
            Hide unused types
          </label>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-check">Use</th>
              <th>Type name</th>
              <th className="num">Instances</th>
              <th className="num">Quantity ({unit})</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const header = t.revitMaterial !== lastMat;
              lastMat = t.revitMaterial;
              return (
                <FragmentRows key={t.id} header={header ? t.revitMaterial : null}>
                  <tr className={t.instances === 0 ? 'unused' : ''}>
                    <td className="col-check">
                      <input type="checkbox" className="checkbox" checked={t.include} onChange={(e) => updateType(t.id, { include: e.target.checked })} aria-label={`Include ${t.name}`} />
                    </td>
                    <td>
                      {t.name}
                      {t.ifcKind && t.ifcKind !== t.kind && <span className={`tag kind-${t.ifcKind}`}>{KIND_LABEL[t.ifcKind] ?? t.ifcKind}</span>}
                      {t.instances === 0 && <span className="tag">unused</span>}
                      {t.flags?.map((f) => <span key={f} className="tag warn" title={FLAG_HINT[f]}>{f.replace(/_/g, ' ')}</span>)}
                    </td>
                    <td className="num">{t.instances}</td>
                    <td className="num">{fmt(t.modelQty)}</td>
                  </tr>
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </section>
      <StepFooter onBack={onBack} onNext={onNext} />
    </>
  );
}

function FragmentRows({ header, children }: { header: string | null; children: ReactNode }) {
  return (
    <>
      {header && (
        <tr className="group-row">
          <td colSpan={6}>Structural material: {header}</td>
        </tr>
      )}
      {children}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { roof: 'Roof', ceiling: 'Ceiling', curtain_wall: 'Curtain wall', floor: 'Floor', wall: 'Wall' };
const FLAG_HINT: Record<string, string> = {
  finish_only: 'Finish layers only (soffit, wall tile): flagged by the extractor',
  placeholder_material: 'Revit placeholder material (Default Wall/Floor): define the layers',
  no_layers: 'No material layers in the IFC',
  layer_thickness_unknown: 'A layer has no thickness in the IFC',
  layer_name_thickness_mismatch: 'Layer name and modelled thickness disagree; modelled thickness used',
};

const STATUS_LABEL = { todo: 'To do', done: 'Done', skipped: 'Skipped', merged: 'Merged' } as const;

function TypeTableStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { types, materials } = useLtl();
  const included = useMemo(
    () => types.filter((t) => t.include).sort((a, b) => (a.kind === b.kind ? a.revitMaterial.localeCompare(b.revitMaterial) : a.kind === 'floor' ? -1 : 1)),
    [types],
  );
  const excluded = types.length - included.length;
  let lastKey = '';
  return (
    <>
      <section className="card">
        <h2 className="card-title">Types in this takeoff</h2>
        <p className="muted">{included.length} types included · {excluded} filtered out. Dead loads reflect the assemblies built in the previous step.</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Type name</th>
              <th>Assembly</th>
              <th className="num">Instances</th>
              <th className="num">Quantity</th>
              <th className="num">Dead load (psf)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {included.map((t) => {
              const key = `${t.kind}|${t.revitMaterial}`;
              const header = key !== lastKey;
              lastKey = key;
              return (
                <FragmentRows key={t.id} header={header ? `${t.kind === 'floor' ? 'Floors' : 'Walls'} · ${t.revitMaterial}` : null}>
                  <tr>
                    <td>
                      <span className="swatch" style={{ background: t.color }} /> {t.name}
                      {t.ifcKind && t.ifcKind !== t.kind && <span className={`tag kind-${t.ifcKind}`}>{KIND_LABEL[t.ifcKind] ?? t.ifcKind}</span>}
                    </td>
                    <td>{t.assemblyName}</td>
                    <td className="num">{t.instances}</td>
                    <td className="num">{fmt(t.modelQty)} {t.kind === 'floor' ? 'SF' : 'LF'}</td>
                    <td className="num">{fmt(assemblyPsf(effectiveLayers(t, types), materials), 1)}</td>
                    <td><span className={`status ${t.status}`}>{STATUS_LABEL[t.status]}</span></td>
                  </tr>
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </section>
      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Next: plan view" />
    </>
  );
}
