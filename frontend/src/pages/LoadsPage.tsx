import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Search, Trash2, Upload } from 'lucide-react';
import readXlsxFile from 'read-excel-file/browser';
import {
  DEAD,
  LIVE,
  groupOf,
  loadSavedTable,
  parseLoadWorkbook,
  readSheetComments,
  saveTable,
  type Cell,
  type LoadKind,
  type LoadTable,
} from '../ltl/loads';

const fmt = (c: Cell) => (c == null ? '' : typeof c === 'number' ? c.toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(c));

interface TabConfig {
  id: string;
  label: string;
  kind: LoadKind;
  storageKey: string;
  /** Split "Group: item" labels in the first column into group headings. */
  groupByColon?: boolean;
  /** Columns offered as dropdown filters. */
  filters?: RegExp[];
}

const TABS: TabConfig[] = [
  { id: 'live', label: 'Live loads', kind: LIVE, storageKey: 'ltl.loadTable.v1', groupByColon: true },
  { id: 'dead', label: 'Dead loads', kind: DEAD, storageKey: 'ltl.deadLoadTable.v1', filters: [/^material$/i, /orientation/i, /use|component/i] },
];

export default function LoadsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Loads</h1>
      </header>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab.id ? 'on' : ''} onClick={() => setParams({ tab: t.id }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted">
        Code and catalog load tables are licensed, so they are not built into the app. Upload your own copy (.xlsx); it is
        read in this browser and kept on this device only.
      </p>
      <LoadTablePanel key={tab.id} config={tab} />
    </div>
  );
}

function LoadTablePanel({ config }: { config: TabConfig }) {
  const [table, setTable] = useState<LoadTable | null>(() => loadSavedTable(config.storageKey));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const sheets = await readXlsxFile(file);
      // Parse once to learn which sheet holds the table, then attach that sheet's cell comments.
      const first = parseLoadWorkbook(file.name, sheets, config.kind);
      let comments: Map<number, string[]> | undefined;
      try {
        comments = readSheetComments(new Uint8Array(await file.arrayBuffer()), first.sheetName);
      } catch {
        comments = undefined; // comments are optional; the table still loads
      }
      const t = comments?.size ? parseLoadWorkbook(file.name, sheets, config.kind, comments) : first;
      setTable(t);
      setPicked({});
      saveTable(config.storageKey, t);
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setTable(null);
    saveTable(config.storageKey, null);
  };

  const input = (
    <input
      ref={fileInput}
      type="file"
      accept=".xlsx"
      hidden
      onChange={(e) => {
        open(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  if (!table) {
    return (
      <>
        {input}
        {error && <div className="banner error">{error}</div>}
        <section className="card">
          <div className="empty" onClick={() => fileInput.current?.click()}>
            <Upload size={28} strokeWidth={1.5} />
            <p>{busy ? 'Reading…' : `Click to upload a ${config.label.toLowerCase()} table (.xlsx)`}</p>
            <p className="muted">Needs {config.kind.describe}. Cell comments are shown as flags; a “Notes” sheet or notes below the table are shown too.</p>
          </div>
        </section>
      </>
    );
  }

  const notesFor = (i: number) => table.rowNotes?.[i] ?? null;
  const filterCols = (config.filters ?? [])
    .map((re) => table.columns.findIndex((c) => re.test(c)))
    .filter((i, n, all) => i >= 0 && all.indexOf(i) === n);
  const optionsFor = (col: number) =>
    [...new Set(table.rows.map((r) => r[col]).filter((c): c is string => typeof c === 'string'))].sort((a, b) => a.localeCompare(b));
  const flaggedCount = table.rows.filter((_, i) => notesFor(i)).length;

  const needle = q.trim().toLowerCase();
  const visible = table.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !needle || r.some((c) => fmt(c).toLowerCase().includes(needle)))
    .filter(({ r }) => filterCols.every((col) => !picked[col] || r[col] === picked[col]))
    .filter(({ i }) => !flaggedOnly || notesFor(i));
  const sourceCol = table.columns.findIndex((c) => /source/i.test(c));
  const numCols = new Set(table.columns.map((_, i) => i).filter((i) => table.rows.some((r) => typeof r[i] === 'number')));

  return (
    <>
      {input}
      {error && <div className="banner error">{error}</div>}
      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">{table.title}</h2>
            {table.captions.map((c) => (
              <p key={c} className="muted">{c}</p>
            ))}
            <p className="muted small">
              {visible.length === table.rows.length ? table.rows.length : `${visible.length} of ${table.rows.length}`} rows from{' '}
              {table.fileName} › {table.sheetName}
              {flaggedCount > 0 && ` · ${flaggedCount} flagged`}
            </p>
          </div>
          <div className="row-gap">
            <label className="search">
              <Search size={14} />
              <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload size={16} /> Replace
            </button>
            <button className="btn danger" onClick={clear}>
              <Trash2 size={16} /> Remove
            </button>
          </div>
        </div>
        {(filterCols.length > 0 || flaggedCount > 0) && (
          <div className="row-gap" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            {filterCols.map((col) => (
              <select
                key={col}
                value={picked[col] ?? ''}
                onChange={(e) => setPicked((p) => ({ ...p, [col]: e.target.value }))}
                aria-label={`Filter by ${table.columns[col]}`}
              >
                <option value="">All {table.columns[col]}</option>
                {optionsFor(col).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ))}
            {flaggedCount > 0 && (
              <label className="row-gap">
                <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only
              </label>
            )}
          </div>
        )}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={i} className={numCols.has(i) ? 'num' : undefined}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, i }, vi) => {
                const group = config.groupByColon ? groupOf(r[0]) : '';
                const grouped = !!config.groupByColon && group !== String(r[0] ?? '');
                const showGroup = grouped && (vi === 0 || groupOf(visible[vi - 1].r[0]) !== group);
                const notes = notesFor(i);
                return [
                  showGroup && (
                    <tr key={`g${i}`} className="group-row">
                      <td colSpan={table.columns.length}>{group}</td>
                    </tr>
                  ),
                  <tr key={i}>
                    {r.map((c, ci) => (
                      <td
                        key={ci}
                        className={numCols.has(ci) ? 'num' : ci > 0 ? 'muted' : undefined}
                        // Indent rows that sit under a group heading so ungrouped rows read as top-level.
                        style={{ ...(ci === 0 && grouped ? { paddingLeft: 26 } : {}), ...(notes ? { borderBottom: 0 } : {}) }}
                      >
                        {ci === 0 && notes && <AlertTriangle size={13} color="#b45309" style={{ marginRight: 4, verticalAlign: -2 }} />}
                        {ci === 0 && grouped ? String(c).slice(group.length + 1).trim() : fmt(c)}
                        {ci === sourceCol && typeof c === 'string' && /sample/i.test(c) && <span className="tag">not a code value</span>}
                      </td>
                    ))}
                  </tr>,
                  notes && (
                    <tr key={`n${i}`}>
                      <td colSpan={table.columns.length} className="small" style={{ color: '#b45309', paddingTop: 0 }}>
                        {notes.join(' ')}
                      </td>
                    </tr>
                  ),
                ];
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={table.columns.length} className="muted">No rows match the search or filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {(table.footer?.length ?? 0) > 0 && (
        <section className="card">
          {table.footer!.map((f, i) =>
            i === 0 && /^notes?:?$/i.test(f) ? (
              <h2 key={i} className="card-title">Notes</h2>
            ) : (
              <p key={i} className="muted">{f}</p>
            ),
          )}
        </section>
      )}

      {table.notes.length > 0 && (
        <section className="card">
          <h2 className="card-title">Notes</h2>
          <table className="data-table">
            <tbody>
              {table.notes.map((n, i) => (
                <tr key={i}>
                  <td className="muted">{n.ref}</td>
                  <td>{n.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
