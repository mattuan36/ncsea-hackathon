import { useId } from 'react';
import type { Category, Kind, Layer } from './data';
import { fmt, fmtIn, layerPsf } from './calc';
import { useLtl } from './store';

type Pattern = 'dots' | 'hatch' | 'cross' | 'vert' | 'brick' | 'zigzag';
const CAT_STYLE: Record<Category, { fill: string; pattern?: Pattern }> = {
  Concrete: { fill: '#e5e7eb', pattern: 'dots' },
  'Steel deck': { fill: '#cbd5e1', pattern: 'zigzag' },
  Masonry: { fill: '#f3d9bf', pattern: 'brick' },
  Insulation: { fill: '#fef3c7', pattern: 'cross' },
  Gypsum: { fill: '#f8fafc', pattern: 'hatch' },
  Framing: { fill: '#e2e8f0', pattern: 'vert' },
  Finish: { fill: '#ede9fe' },
  Roofing: { fill: '#334155' },
  Glazing: { fill: '#dbeafe', pattern: 'hatch' },
  Allowance: { fill: 'none' },
};

function Patterns({ pid }: { pid: string }) {
  const s = '#64748b';
  return (
    <defs>
      <pattern id={`${pid}-dots`} width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="0.8" fill={s} />
        <circle cx="4.5" cy="4.2" r="0.6" fill={s} />
      </pattern>
      <pattern id={`${pid}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" stroke={s} strokeWidth="0.6" />
      </pattern>
      <pattern id={`${pid}-cross`} width="6" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 0L6 6M6 0L0 6" stroke="#b45309" strokeWidth="0.5" />
      </pattern>
      <pattern id={`${pid}-vert`} width="8" height="8" patternUnits="userSpaceOnUse">
        <line x1="4" y1="0" x2="4" y2="8" stroke={s} strokeWidth="0.8" />
      </pattern>
      <pattern id={`${pid}-brick`} width="12" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 0H12M0 3H12M3 0V3M9 3V6" stroke="#b45309" strokeWidth="0.5" fill="none" />
      </pattern>
      <pattern id={`${pid}-zigzag`} width="8" height="6" patternUnits="userSpaceOnUse">
        <path d="M0 5L2 1H6L8 5" stroke="#334155" strokeWidth="0.8" fill="none" />
      </pattern>
    </defs>
  );
}

/** Labeled section of an assembly: floors stack top→bottom, walls run exterior→interior. */
export default function AssemblyGraphic({ kind, layers, compact = false }: { kind: Kind; layers: Layer[]; compact?: boolean }) {
  const { materials } = useLtl();
  const pid = `p${useId().replace(/:/g, '')}`;
  const rows = layers.map((l, i) => {
    const m = materials.find((x) => x.id === l.materialId);
    return { l, m, n: i + 1, psf: layerPsf(l, materials), style: CAT_STYLE[m?.category ?? 'Finish'] };
  });
  const solid = rows.filter((r) => r.l.thickness > 0);
  const allowances = rows.filter((r) => r.l.thickness === 0);
  const total = solid.reduce((s, r) => s + r.l.thickness, 0) || 1;
  const label = (r: (typeof rows)[number]) =>
    `${r.l.thickness ? fmtIn(r.l.thickness) + ' ' : ''}${r.m?.name ?? 'Unknown material'} — ${fmt(r.psf, 1)} psf`;
  // compact (spreadsheet) mode: numbered callouts only; the rows beside it carry the text
  const fontSize = compact ? 14 : 13;
  const text = (r: (typeof rows)[number]) => (compact ? String(r.n) : label(r));

  // label column sized to the longest label so the drawing isn't shrunk by empty space
  const textW = Math.max(0, ...rows.map((r) => label(r).length)) * fontSize * 0.56 + 8;
  const fillOf = (r: (typeof rows)[number]) => (r.style.pattern ? `url(#${pid}-${r.style.pattern})` : r.style.fill);

  if (kind === 'floor') {
    const W = compact ? 120 : 240;
    const scale = Math.min(compact ? 14 : 24, (compact ? 90 : 240) / total);
    let y = 8;
    const rects = solid.map((r) => {
      const h = Math.max(r.l.thickness * scale, 8);
      const o = { ...r, y, h };
      y += h;
      return o;
    });
    // spread labels so thin layers don't collide
    let lastY = -Infinity;
    const labels = rects.map((r) => {
      const ly = Math.max(r.y + r.h / 2, lastY + fontSize + 4);
      lastY = ly;
      return { r, ly };
    });
    const allowTop = Math.max(y, lastY) + 14;
    const height = allowTop + allowances.length * (fontSize + 8) + 6;
    const labelX = W + 24;
    return (
      <svg className="assembly-graphic" viewBox={`0 0 ${labelX + (compact ? 30 : textW)} ${height}`} role="img" aria-label="Assembly section">
        <Patterns pid={pid} />
        {rects.map((r) => (
          <g key={r.l.id}>
            <rect x="0" y={r.y} width={W} height={r.h} fill={r.style.fill} stroke="#475569" strokeWidth="0.8" />
            <rect x="0" y={r.y} width={W} height={r.h} fill={fillOf(r)} stroke="none" />
          </g>
        ))}
        {labels.map(({ r, ly }) => (
          <g key={`lab-${r.l.id}`}>
            <polyline points={`${W},${r.y + r.h / 2} ${W + 10},${ly} ${labelX - 4},${ly}`} fill="none" stroke="#94a3b8" strokeWidth="0.8" />
            <text x={labelX} y={ly + fontSize / 3} fontSize={fontSize} fill="#1e293b">{text(r)}</text>
          </g>
        ))}
        {allowances.map((r, i) => {
          const ay = allowTop + i * (fontSize + 8);
          return (
            <g key={r.l.id}>
              <line x1="0" y1={ay} x2={W} y2={ay} stroke="#64748b" strokeDasharray="4 3" />
              <text x={labelX} y={ay + fontSize / 3} fontSize={fontSize} fill="#475569" fontStyle="italic">{text(r)}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  // wall: vertical layers left (exterior) to right (interior), numbered callouts + key
  const H = compact ? 90 : 220;
  const scale = Math.min(compact ? 16 : 24, (compact ? 110 : 260) / total);
  let x = 4;
  const cols = solid.map((r) => {
    const w = Math.max(r.l.thickness * scale, 6);
    const o = { ...r, x, w };
    x += w;
    return o;
  });
  const keyX = x + 36;
  const keyRows = [...cols, ...allowances.map((r) => ({ ...r, x: 0, w: 0 }))];
  const height = compact ? H + 34 : Math.max(H + 34, keyRows.length * (fontSize + 8) + 30);
  return (
    <svg className="assembly-graphic" viewBox={`0 0 ${compact ? x + 8 : keyX + textW} ${height}`} role="img" aria-label="Wall section">
      <Patterns pid={pid} />
      <text x="4" y={H + 30} fontSize={fontSize - 1} fill="#64748b">EXT</text>
      <text x={x - 4} y={H + 30} fontSize={fontSize - 1} fill="#64748b" textAnchor="end">INT</text>
      {cols.map((r) => (
        <g key={r.l.id}>
          <rect x={r.x} y="16" width={r.w} height={H} fill={r.style.fill} stroke="#475569" strokeWidth="0.8" />
          <rect x={r.x} y="16" width={r.w} height={H} fill={fillOf(r)} />
          <circle cx={r.x + r.w / 2} cy="8" r="6.5" fill="#fff" stroke="#475569" strokeWidth="0.8" />
          <text x={r.x + r.w / 2} y="11" fontSize="9" textAnchor="middle" fill="#0f172a">{r.n}</text>
        </g>
      ))}
      {!compact && keyRows.map((r, i) => (
        <g key={`k-${r.l.id}`}>
          <circle cx={keyX - 14} cy={18 + i * (fontSize + 8)} r="6.5" fill="#fff" stroke="#475569" strokeWidth="0.8" />
          <text x={keyX - 14} y={21 + i * (fontSize + 8)} fontSize="9" textAnchor="middle">{r.n}</text>
          <text x={keyX} y={18 + i * (fontSize + 8) + fontSize / 3} fontSize={fontSize} fill={r.l.thickness ? '#1e293b' : '#475569'} fontStyle={r.l.thickness ? 'normal' : 'italic'}>
            {label(r)}
          </text>
        </g>
      ))}
    </svg>
  );
}
