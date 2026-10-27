// Load tables: built-in JSON (src/ltl/data, from scripts/xlsx_to_load_tables.py) or a user's own
// .xlsx read in the browser. The source tables (IBC Table 1607.1, ASCE 7 Table C3.1-1a, Vulcraft
// catalog) are licensed content; see the note in the commit that added the data files.
import { strFromU8, unzipSync } from 'fflate';

export type Cell = string | number | boolean | null;

export interface LoadTable {
  fileName: string;
  sheetName: string;
  title: string;
  captions: string[];
  columns: string[];
  rows: Cell[][];
  /** Cell comments per row (same index as `rows`), e.g. the sheet's "CHECK:" flags. */
  rowNotes?: (string[] | null)[];
  /** Text below the table on the same sheet (a "Notes:" block). */
  footer?: string[];
  notes: { ref: string; text: string }[];
}

export interface LoadKind {
  /** Preferred sheet name. */
  sheet: RegExp;
  /** Every pattern must match some cell of the header row. */
  header: RegExp[];
  describe: string;
}

export const LIVE: LoadKind = {
  sheet: /live\s*load/i,
  header: [/occupancy/i, /psf|load|kn/i],
  describe: 'a header row with an “Occupancy or use” column and a load column such as “Uniform (psf)”',
};

export const DEAD: LoadKind = {
  sheet: /dead\s*load/i,
  header: [/material/i, /psf|kn/i],
  describe: 'a header row with a “material” column and a “psf” column',
};

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

function findHeader(rows: Cell[][], kind: LoadKind): number {
  return rows.findIndex((r) => kind.header.every((re) => r.some((c) => typeof c === 'string' && re.test(c))));
}

/** `comments` maps 1-based sheet row numbers to that row's cell comments. */
export function parseLoadWorkbook(fileName: string, sheets: Sheet[], kind: LoadKind = LIVE, comments?: Map<number, string[]>): LoadTable {
  const all = sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(clean)) }));
  const main = all.find((s) => kind.sheet.test(s.name) && findHeader(s.rows, kind) >= 0) ?? all.find((s) => findHeader(s.rows, kind) >= 0);
  if (!main) throw new Error(`No table found. Expected ${kind.describe}.`);

  const h = findHeader(main.rows, kind);
  const header = main.rows[h];
  const firstCol = header.findIndex((c) => c != null);
  const lastCol = header.reduce<number>((last, c, i) => (c != null ? i : last), -1);
  const columns = header.slice(firstCol, lastCol + 1).map((c, i) => (c == null ? `Column ${firstCol + i + 1}` : String(c)));
  const take = (r: Cell[]) => columns.map((_, i) => r[firstCol + i] ?? null);

  const above = main.rows.slice(0, h).filter((r) => !isBlank(r)).map((r) => r.filter((c) => c != null).join(' '));

  // Data runs from the header to the first blank row; anything after a gap is footer text.
  const rows: Cell[][] = [];
  const rowNotes: (string[] | null)[] = [];
  let i = h + 1;
  for (; i < main.rows.length && !isBlank(main.rows[i]); i++) {
    rows.push(take(main.rows[i]));
    rowNotes.push(comments?.get(i + 1) ?? null);
  }
  const footer = main.rows.slice(i).filter((r) => !isBlank(r)).map((r) => r.filter((c) => c != null).join(' '));

  const notesSheet = all.find((s) => s !== main && /note/i.test(s.name));
  const notes = (notesSheet?.rows ?? [])
    .filter((r) => r[0] != null || r[1] != null)
    .filter((r, n) => !(n === 0 && String(r[0]).toLowerCase() === 'reference'))
    .map((r) => ({ ref: String(r[0] ?? ''), text: String(r[1] ?? '') }));

  return { fileName, sheetName: main.name, title: above[0] ?? main.name, captions: above.slice(1), columns, rows, rowNotes, footer, notes };
}

/**
 * Cell comments of one sheet, keyed by 1-based row number. read-excel-file does not read
 * comments, so this opens the .xlsx package directly. Missing parts just mean no comments.
 */
export function readSheetComments(bytes: Uint8Array, sheetName: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const zip = unzipSync(bytes);
  const xml = (path: string) => (zip[path] ? new DOMParser().parseFromString(strFromU8(zip[path]), 'application/xml') : null);
  const target = (relsPath: string, id: string | null, type: RegExp) => {
    const rel = [...(xml(relsPath)?.getElementsByTagName('Relationship') ?? [])].find(
      (r) => (id == null || r.getAttribute('Id') === id) && type.test(r.getAttribute('Type') ?? ''),
    );
    return rel?.getAttribute('Target') ?? null;
  };
  const resolve = (base: string, t: string) => {
    if (t.startsWith('/')) return t.slice(1);
    const parts = base.split('/').slice(0, -1);
    for (const seg of t.split('/')) seg === '..' ? parts.pop() : parts.push(seg);
    return parts.join('/');
  };

  const sheetEl = [...(xml('xl/workbook.xml')?.getElementsByTagName('sheet') ?? [])].find((s) => s.getAttribute('name') === sheetName);
  const rid = sheetEl?.getAttribute('r:id') ?? null;
  const sheetTarget = rid && target('xl/_rels/workbook.xml.rels', rid, /worksheet$/);
  if (!sheetTarget) return out;
  const sheetPath = resolve('xl/workbook.xml', sheetTarget);
  const relsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const commentsTarget = target(relsPath, null, /\/comments$/);
  if (!commentsTarget) return out;

  for (const c of [...(xml(resolve(sheetPath, commentsTarget))?.getElementsByTagName('comment') ?? [])]) {
    const row = Number(/\d+$/.exec(c.getAttribute('ref') ?? '')?.[0]);
    const text = [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('').trim();
    if (row && text) out.set(row, [...(out.get(row) ?? []), text]);
  }
  return out;
}

/** "Assembly areas: Lobbies" → "Assembly areas"; rows without a colon group under themselves. */
export const groupOf = (label: Cell) => {
  const s = String(label ?? '');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(0, i) : s;
};

// Kept in this browser only, so a table survives a reload without leaving the device.
export function loadSavedTable(key: string): LoadTable | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LoadTable) : null;
  } catch {
    return null;
  }
}

export function saveTable(key: string, t: LoadTable | null): void {
  try {
    if (t) localStorage.setItem(key, JSON.stringify(t));
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private window); table stays for this session only */
  }
}
