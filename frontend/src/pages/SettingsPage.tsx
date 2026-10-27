import { useLtl } from '../ltl/store';
import { WireframeNote } from '../ltl/ui';

export default function SettingsPage() {
  const { projectName, setProjectName, model, isDemo } = useLtl();

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      <WireframeNote>
        {isDemo
          ? 'Demo project: changes here live in the browser session only and reset on reload.'
          : 'Saved with the uploaded model: the project name is kept after a reload.'}
      </WireframeNote>

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

    </div>
  );
}
