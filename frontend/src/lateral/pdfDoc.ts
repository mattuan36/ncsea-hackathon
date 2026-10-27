/** Minimal PDF 1.4 writer for letter-size calculation sheets. Built-in Helvetica only. */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_L = 48;
const MARGIN_R = 48;
const MARGIN_T = 40;
const MARGIN_B = 46;

type Align = "left" | "center" | "right";

interface Cell {
  text: string;
  align?: Align;
  bold?: boolean;
}

export class PdfDoc {
  private pages: string[][] = [];
  private ops: string[] = [];
  private y = PAGE_H - MARGIN_T;
  private size = 9;
  private bold = false;
  private header: { left: string; center: string; right: string } | null = null;
  private footerNote = "";

  constructor(header?: { left: string; center: string; right: string }, footerNote = "") {
    this.header = header ?? null;
    this.footerNote = footerNote;
    this.ops = [];
    this.pages = [];
    this.beginPage();
  }

  get width() {
    return PAGE_W - MARGIN_L - MARGIN_R;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN_B) this.newPage();
  }

  newPage() {
    this.pages.push(this.ops);
    this.ops = [];
    this.beginPage();
  }

  private beginPage() {
    this.y = PAGE_H - MARGIN_T;
    this.size = 9;
    this.bold = false;
    if (this.header) {
      this.setFont(8, true);
      this.drawText(MARGIN_L, PAGE_H - 28, this.header.left, 8, true);
      this.drawText(PAGE_W / 2, PAGE_H - 28, this.header.center, 8, true, "center");
      this.drawText(PAGE_W - MARGIN_R, PAGE_H - 28, this.header.right, 8, true, "right");
      this.stroke(MARGIN_L, PAGE_H - 34, PAGE_W - MARGIN_R, PAGE_H - 34, 0.8);
      this.y = PAGE_H - 46;
    }
  }

  setFont(size: number, bold = false) {
    this.size = size;
    this.bold = bold;
  }

  rule(weight = 0.6) {
    this.ensure(10);
    this.stroke(MARGIN_L, this.y, PAGE_W - MARGIN_R, this.y, weight);
    this.y -= 8;
  }

  gap(n = 6) {
    this.y -= n;
  }

  title(text: string) {
    this.ensure(22);
    this.setFont(13, true);
    this.line(text);
    this.gap(2);
  }

  heading(text: string) {
    this.ensure(20);
    this.gap(4);
    this.setFont(10, true);
    this.line(text);
    this.rule(0.5);
  }

  body(text: string) {
    this.setFont(9, false);
    this.wrap(text);
  }

  italicNote(text: string) {
    this.setFont(8, false);
    this.wrap(text);
  }

  line(text: string, opts?: { indent?: number; bold?: boolean; size?: number; align?: Align }) {
    const size = opts?.size ?? this.size;
    const bold = opts?.bold ?? this.bold;
    const indent = opts?.indent ?? 0;
    this.ensure(size + 4);
    this.drawText(MARGIN_L + indent, this.y, text, size, bold, opts?.align ?? "left", this.width - indent);
    this.y -= size + 4;
  }

  wrap(text: string, indent = 0) {
    const width = this.width - indent;
    for (const paragraph of text.split("\n")) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) {
        this.y -= this.size;
        continue;
      }
      let current = words[0];
      for (let i = 1; i < words.length; i++) {
        const next = `${current} ${words[i]}`;
        if (textWidth(next, this.size) <= width) current = next;
        else {
          this.line(current, { indent });
          current = words[i];
        }
      }
      this.line(current, { indent });
    }
  }

  keyValues(rows: [string, string][], columns = 2) {
    const colW = this.width / columns;
    const rowH = 14;
    const rowsNeeded = Math.ceil(rows.length / columns);
    this.ensure(rowsNeeded * rowH + 4);
    for (let r = 0; r < rowsNeeded; r++) {
      for (let c = 0; c < columns; c++) {
        const item = rows[r * columns + c];
        if (!item) continue;
        const x = MARGIN_L + c * colW;
        this.drawText(x, this.y, item[0], 8, true);
        this.drawText(x + 118, this.y, item[1] || "—", 8, false);
      }
      this.y -= rowH;
    }
    this.gap(2);
  }

  table(headers: string[], rows: string[][], widths?: number[]) {
    const cols = headers.length;
    const w = widths && widths.length === cols ? widths : Array.from({ length: cols }, () => this.width / cols);
    const aligns: Align[] = headers.map((_, i) => (i >= 2 ? "right" : "left"));
    const estimated = 16 + rows.reduce((sum, row) => sum + Math.max(14, 13 + extraWrapHeight(row, w, 8)), 0);
    if (estimated < 220) this.ensure(estimated + 4);
    this.drawRow(headers.map((text, i) => ({ text, bold: true, align: i === 0 ? "left" : "center" })), w, 16, true);
    for (const row of rows) {
      const cells = row.map((text, i) => ({ text, align: aligns[i] ?? "left" }));
      const height = 13 + extraWrapHeight(row, w, 8);
      this.drawRow(cells, w, Math.max(14, height), false);
    }
    this.gap(6);
  }

  checkbox(label: string, checked = false) {
    this.ensure(16);
    const x = MARGIN_L;
    const y = this.y - 2;
    this.rect(x, y - 7, 8, 8, 0.7);
    if (checked) {
      this.stroke(x + 1.5, y - 3, x + 3.5, y - 6.5, 1);
      this.stroke(x + 3.5, y - 6.5, x + 6.5, y - 1.5, 1);
    }
    this.drawText(x + 14, this.y, label, 8, false);
    this.y -= 14;
  }

  signOff(lines: [string, string][]) {
    this.ensure(52);
    this.gap(4);
    const col = this.width / lines.length;
    lines.forEach(([label, value], i) => {
      const x = MARGIN_L + i * col;
      this.stroke(x, this.y - 14, x + col - 12, this.y - 14, 0.6);
      this.drawText(x, this.y - 12, label, 7, true);
      this.drawText(x, this.y, value || " ", 8, false);
    });
    this.y -= 32;
  }

  private drawRow(cells: Cell[], widths: number[], height: number, header: boolean) {
    this.ensure(height + 2);
    let x = MARGIN_L;
    if (header) this.fill(MARGIN_L, this.y - height + 10, this.width, height, 0.92);
    this.rect(MARGIN_L, this.y - height + 10, this.width, height, 0.5);
    let cx = MARGIN_L;
    for (const width of widths.slice(0, -1)) {
      cx += width;
      this.stroke(cx, this.y - height + 10, cx, this.y + 10, 0.4);
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const pad = 4;
      const lines = wrapToWidth(cell.text || "—", widths[i] - pad * 2, 8);
      lines.forEach((part, li) => {
        const tx = cell.align === "right" ? x + widths[i] - pad : cell.align === "center" ? x + widths[i] / 2 : x + pad;
        this.drawText(tx, this.y - li * 10, part, 8, !!cell.bold, cell.align ?? "left", widths[i] - pad * 2);
      });
      x += widths[i];
    }
    this.y -= height;
  }

  private drawText(x: number, y: number, text: string, size: number, bold: boolean, align: Align = "left", max = 0) {
    let drawn = sanitize(text);
    if (!drawn) return;
    if (max > 0 && textWidth(drawn, size) > max) drawn = ellipsize(drawn, size, max);
    let dx = x;
    if (align === "center") dx = x - textWidth(drawn, size) / 2;
    if (align === "right") dx = x - textWidth(drawn, size);
    const font = bold ? "F2" : "F1";
    this.ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${n(dx)} ${n(y)} Tm (${esc(drawn)}) Tj ET`);
  }

  private stroke(x1: number, y1: number, x2: number, y2: number, w: number) {
    this.ops.push(`${n(w)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
  }

  private rect(x: number, y: number, w: number, h: number, weight: number) {
    this.ops.push(`${n(weight)} w ${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`);
  }

  private fill(x: number, y: number, w: number, h: number, gray: number) {
    this.ops.push(`q ${n(gray)} g ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f Q`);
  }

  build(): Uint8Array {
    if (this.ops.length) this.pages.push(this.ops);
    const total = this.pages.length || 1;
    const finalized = this.pages.map((ops, i) => {
      const extra: string[] = [];
      extra.push("0.45 G");
      extra.push(`0.6 w ${n(MARGIN_L)} ${n(32)} m ${n(PAGE_W - MARGIN_R)} ${n(32)} l S`);
      extra.push("0 G");
      extra.push(`BT /F1 7 Tf 1 0 0 1 ${n(MARGIN_L)} 22 Tm (${esc(this.footerNote || "Engineer confirmation required before design use.")}) Tj ET`);
      extra.push(`BT /F1 7 Tf 1 0 0 1 ${n(PAGE_W - MARGIN_R - 70)} 22 Tm (${esc(`Sheet ${i + 1} of ${total}`)}) Tj ET`);
      return [...ops, ...extra];
    });

    const objects: string[] = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const pageIds = finalized.map((_, i) => 5 + i * 2);
    objects.push(`<< /Type /Pages /Count ${finalized.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    for (const ops of finalized) {
      const stream = ops.join("\n");
      const pageNo = objects.length + 1;
      const contentNo = pageNo + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`,
      );
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }

    let offset = 0;
    const chunks: string[] = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
    offset = lengthOf(chunks[0]);
    const xref = [0];
    objects.forEach((body, i) => {
      xref.push(offset);
      const obj = `${i + 1} 0 obj\n${body}\nendobj\n`;
      chunks.push(obj);
      offset += lengthOf(obj);
    });
    const xrefStart = offset;
    let xrefTable = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) xrefTable += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
    chunks.push(xrefTable);
    chunks.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
    return new TextEncoder().encode(chunks.join(""));
  }
}

function n(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function sanitize(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, (ch) => {
    const map: Record<string, string> = {
      "–": "-",
      "—": "-",
      "’": "'",
      "‘": "'",
      "“": '"',
      "”": '"',
      "×": "x",
      "·": "-",
    };
    return map[ch] ?? "-";
  });
}

function lengthOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

const CHAR_W: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "%": 889, "'": 191, "(": 333, ")": 333, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 278, ";": 278, "=": 584, "?": 556, "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611,
  "G": 778, "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 778, "P": 667,
  "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
  "_": 556, "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556, "i": 222,
  "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556, "q": 556, "r": 333, "s": 500,
  "t": 278, "u": 556, "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
};

function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of sanitize(text)) w += CHAR_W[ch] ?? 556;
  return (w * size) / 1000;
}

function ellipsize(text: string, size: number, max: number): string {
  if (textWidth(text, size) <= max) return text;
  let out = text;
  while (out.length && textWidth(`${out}...`, size) > max) out = out.slice(0, -1);
  return `${out}...`;
}

function wrapToWidth(text: string, width: number, size: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${current} ${words[i]}`;
    if (textWidth(next, size) <= width) current = next;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines.slice(0, 3);
}

function extraWrapHeight(row: string[], widths: number[], size: number): number {
  let extra = 0;
  row.forEach((cell, i) => {
    extra = Math.max(extra, (wrapToWidth(cell, widths[i] - 8, size).length - 1) * 10);
  });
  return extra;
}
