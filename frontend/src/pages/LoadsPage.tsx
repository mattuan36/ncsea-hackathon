import { useRef, useState } from 'react';
import { Search, Trash2, Upload } from 'lucide-react';
import readXlsxFile from 'read-excel-file/browser';
import { groupOf, loadSavedTable, parseLoadWorkbook, saveTable, type Cell, type LoadTable } from '../ltl/loads';

const fmt = (c: Cell) => (c == null ? '' : typeof c === 'number' ? c.toLocaleString() : String(c));

export default function LoadsPage() {
  const [table, setTable] = useState<LoadTable | null>(loadSavedTable);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const t = parseLoadWorkbook(file.name, await readXlsxFile(file));
      setTable(t);
      saveTable(t);
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setTable(null);
    saveTable(null);
  };

  const needle = q.trim().toLowerCase();
  const rows = (table?.rows ?? []).filter((r) => !needle || r.some((c) => fmt(c).toLowerCase().includes(needle)));
  const sourceCol = table?.columns.findIndex((c) => /source/i.test(c)) ?? -1;
  const isNum = (i: number) => rows.some((r) => typeof r[i] === 'number');

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Loads</h1>
      </header>
      <p className="muted">
        Code load tables are licensed, so they are not built into the app. Upload your own copy (.xlsx); it is read in this
        browser and kept on this device only.
      </p>

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
      {error && <div className="banner error">{error}</div>}

      {!table ? (
        <section className="card">
          <div className="empty" onClick={() => fileInput.current?.click()}>
            <Upload size={28} strokeWidth={1.5} />
            <p>{busy ? 'Reading…' : 'Click to upload a live-load table (.xlsx)'}</p>
            <p className="muted">Needs a header row with an “Occupancy or use” column and a load column such as “Uniform (psf)”. A “Notes” sheet is shown below the table.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">{table.title}</h2>
                {table.captions.map((c) => (
                  <p key={c} className="muted">{c}</p>
                ))}
                <p className="muted small">
                  {table.rows.length} rows from {table.fileName} › {table.sheetName}
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
            <table className="data-table">
              <thead>
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={i} className={isNum(i) ? 'num' : undefined}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  const group = groupOf(r[0]);
                  const grouped = group !== String(r[0] ?? '');
                  const showGroup = grouped && (ri === 0 || groupOf(rows[ri - 1][0]) !== group);
                  return [
                    showGroup && (
                      <tr key={`g${ri}`} className="group-row">
                        <td colSpan={table.columns.length}>{group}</td>
                      </tr>
                    ),
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td
                          key={ci}
                          className={typeof c === 'number' ? 'num' : ci > 0 ? 'muted' : undefined}
                          // Indent rows that sit under a group heading so ungrouped rows read as top-level.
                          style={ci === 0 && grouped ? { paddingLeft: 26 } : undefined}
                        >
                          {ci === 0 && grouped ? String(c).slice(group.length + 1).trim() : fmt(c)}
                          {ci === sourceCol && typeof c === 'string' && /sample/i.test(c) && <span className="tag">not a code value</span>}
                        </td>
                      ))}
                    </tr>,
                  ];
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={table.columns.length} className="muted">No rows match “{q}”.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

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
      )}
    </div>
  );
}
