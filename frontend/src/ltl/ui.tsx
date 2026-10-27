import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { CATEGORIES, type Basis, type Category, type Material } from './data';
import { basisLabel } from './calc';
import { useLtl } from './store';

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{footer}</div>
      </div>
    </div>
  );
}

export function WireframeNote({ children }: { children: ReactNode }) {
  return <div className="wf-note">{children}</div>;
}

/** Searchable material dropdown with an "add to database" escape hatch. */
export function MaterialPicker({ value, onChange, onCreate }: { value: string; onChange: (id: string) => void; onCreate: (query: string) => void }) {
  const { materials } = useLtl();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const current = materials.find((m) => m.id === value);
  const list = useMemo(
    () => materials.filter((m) => `${m.name} ${m.category}`.toLowerCase().includes(q.trim().toLowerCase())),
    [materials, q],
  );

  return (
    <div className="picker" ref={ref}>
      <button type="button" className="picker-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span>{current?.name ?? 'Select material'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="picker-pop">
          <label className="picker-search">
            <Search size={14} />
            <input autoFocus placeholder="Search materials…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <ul role="listbox">
            {list.map((m) => (
              <li
                key={m.id}
                role="option"
                aria-selected={m.id === value}
                className={m.id === value ? 'selected' : ''}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span>{m.name}</span>
                <span className="muted small">
                  {m.category} · {basisLabel(m)}
                </span>
              </li>
            ))}
            {list.length === 0 && <li className="muted small empty-li">No match</li>}
          </ul>
          <button
            type="button"
            className="picker-add"
            onClick={() => {
              setOpen(false);
              onCreate(q.trim());
              setQ('');
            }}
          >
            <Plus size={14} /> {q.trim() ? `Add “${q.trim()}” to database` : 'Add new material to database'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Create a material for the shared database. */
export function MaterialModal({ initialName = '', onClose, onSaved }: { initialName?: string; onClose: () => void; onSaved?: (m: Material) => void }) {
  const { addMaterial } = useLtl();
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<Category>('Concrete');
  const [basis, setBasis] = useState<Basis>('PCF');
  const [unitWeight, setUnitWeight] = useState('');
  const [thk, setThk] = useState('');

  const weight = Number(unitWeight);
  const thicknesses = thk
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const valid = name.trim() && unitWeight !== '' && weight > 0 && thicknesses.length > 0;

  return (
    <Modal
      title="Add material to database"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              const m = addMaterial({ name: name.trim(), category, basis, unitWeight: weight, thicknesses });
              onSaved?.(m);
              onClose();
            }}
          >
            Add material
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Weight basis
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="PCF">PCF (density × thickness)</option>
            <option value="PSF">PSF (fixed per square foot)</option>
          </select>
        </label>
        <label>
          Unit weight ({basis.toLowerCase()})
          <input type="number" min="0" step="0.1" value={unitWeight} onChange={(e) => setUnitWeight(e.target.value)} />
        </label>
        <label className="span-2">
          Thicknesses, inches (comma separated; 0 if not thickness-based)
          <input placeholder="e.g. 2, 3, 4" value={thk} onChange={(e) => setThk(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
