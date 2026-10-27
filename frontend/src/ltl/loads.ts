// Live-load table read from a user's own .xlsx. The rows are never bundled with the app:
// code-table content (e.g. IBC Table 1607.1) is licensed and must not be redistributed.

export type Cell = string | number | boolean | null;

export interface LoadTable {
  fileName: string;
  sheetName: string;
  title: string;
  captions: string[];
  columns: string[];
  rows: Cell[][];
  notes: { ref: string; text: string }[];
}

interface Sheet {
  sheet: string;
  data: unknown[][];
}

const clean = (v: unknown): Cell => {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === '' ? null : s;
};

const isBlank = (row: Cell[]) => row.every((c) => c == null);

/** Header row = first row with an "occupancy"/"use" cell and a load-unit cell. */
function findHeader(rows: Cell[][]): number {
  return rows.findIndex(
    (r) => r.some((c) => typeof c === 'string' && /occupancy|use/i.test(c)) && r.some((c) => typeof c === 'string' && /psf|load|kn/i.test(c)),
  );
}

export function parseLoadWorkbook(fileName: string, sheets: Sheet[]): LoadTable {
  const all = sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(clean)) }));
  const main = all.find((s) => /live\s*load/i.test(s.name) && findHeader(s.rows) >= 0) ?? all.find((s) => findHeader(s.rows) >= 0);
  if (!main) throw new Error('No table found. Expected a header row with an "Occupancy or use" column and a load column (e.g. "Uniform (psf)").');

  const h = findHeader(main.rows);
  const header = main.rows[h];
  const lastCol = header.reduce<number>((last, c, i) => (c != null ? i : last), -1);
  const columns = header.slice(0, lastCol + 1).map((c, i) => (c == null ? `Column ${i + 1}` : String(c)));

  const above = main.rows.slice(0, h).filter((r) => !isBlank(r)).map((r) => r.filter((c) => c != null).join(' '));
  const rows = main.rows
    .slice(h + 1)
    .map((r) => columns.map((_, i) => r[i] ?? null))
    .filter((r) => !isBlank(r));

  const notesSheet = all.find((s) => s !== main && /note/i.test(s.name));
  const notes = (notesSheet?.rows ?? [])
    .filter((r) => r[0] != null || r[1] != null)
    .filter((r, i) => !(i === 0 && String(r[0]).toLowerCase() === 'reference'))
    .map((r) => ({ ref: String(r[0] ?? ''), text: String(r[1] ?? '') }));

  return { fileName, sheetName: main.name, title: above[0] ?? main.name, captions: above.slice(1), columns, rows, notes };
}

/** "Assembly areas: Lobbies" → "Assembly areas"; rows without a colon group under themselves. */
export const groupOf = (label: Cell) => {
  const s = String(label ?? '');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(0, i) : s;
};

// Kept in this browser only, so the table survives a reload without leaving the device.
const STORAGE_KEY = 'ltl.loadTable.v1';

export function loadSavedTable(): LoadTable | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LoadTable) : null;
  } catch {
    return null;
  }
}

export function saveTable(t: LoadTable | null): void {
  try {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private window); table stays for this session only */
  }
}
