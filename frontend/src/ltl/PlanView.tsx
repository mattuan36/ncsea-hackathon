import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitMerge } from 'lucide-react';
import { GRID_X, GRID_Y, LEVELS, PLAN_SIZE, type Pt } from './data';
import { assemblyPsf, fmt, fmtIn, layerPsf, levelTakeoff, polygonArea, polylineLength } from './calc';
import { useLtl } from './store';

const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(' ');

function longestSegmentMid(p: Pt[]): Pt {
  let best = 0;
  let mid: Pt = p[0];
  for (let i = 1; i < p.length; i++) {
    const len = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (len > best) {
      best = len;
      mid = [(p[i][0] + p[i - 1][0]) / 2, (p[i][1] + p[i - 1][1]) / 2];
    }
  }
  return mid;
}

/** Bluebeam-style markup plan with a legend table; click a legend row, area or wall to isolate it. */
export default function PlanView({ initialLevel = LEVELS[0].id, showLevelTabs = true }: { initialLevel?: string; showLevelTabs?: boolean }) {
  const { types, materials } = useLtl();
  const pid = `h${useId().replace(/:/g, '')}`;
  const [levelId, setLevelId] = useState(initialLevel);
  const [focus, setFocus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];
  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const entries = useMemo(() => levelTakeoff(level, types, materials), [level, types, materials]);
  const govOf = (typeId: string) => {
    const t = byId.get(typeId);
    return t ? t.parentId ?? t.id : typeId;
  };
  const colorOf = (typeId: string) => byId.get(govOf(typeId))?.color ?? '#94a3b8';
  const included = (typeId: string) => byId.get(typeId)?.include ?? false;
  const faded = (typeId: string) => focus !== null && govOf(typeId) !== focus;
  const pick = (typeId: string) => setFocus((f) => (f === govOf(typeId) ? null : govOf(typeId)));

  const floorSF = entries.filter((e) => e.kind === 'floor').reduce((s, e) => s + e.qty, 0);
  const wallLF = entries.filter((e) => e.kind === 'wall').reduce((s, e) => s + e.qty, 0);
  const kips = entries.reduce((s, e) => s + e.kips, 0);
  const colorIds = [...new Set(types.map((t) => t.color))];

  return (
    <div className="plan-wrap">
      <div className="plan-canvas">
        <div className="plan-toolbar">
          {showLevelTabs ? (
            <div className="seg">
              {LEVELS.map((l) => (
                <button key={l.id} className={l.id === level.id ? 'on' : ''} onClick={() => { setLevelId(l.id); setFocus(null); }}>
                  {l.name}
                </button>
              ))}
            </div>
          ) : (
            <strong>{level.name}</strong>
          )}
          <span className="muted small">{focus ? 'Click the selection again or empty space to show all' : 'Click an area, wall or legend row to isolate it'}</span>
        </div>
        <svg
          className="plan-svg"
          viewBox={`-16 -16 ${PLAN_SIZE.width + 28} ${PLAN_SIZE.height + 28}`}
          onClick={() => setFocus(null)}
          role="img"
          aria-label={`${level.name} takeoff plan`}
        >
          <defs>
            {colorIds.map((c) => (
              <pattern key={c} id={`${pid}-${c.slice(1)}`} width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="2.4" stroke={c} strokeWidth="0.3" />
              </pattern>
            ))}
          </defs>
          <rect x="-16" y="-16" width={PLAN_SIZE.width + 28} height={PLAN_SIZE.height + 28} fill="#fff" />

          {GRID_X.map((g) => (
            <g key={g.name} className="grid">
              <line x1={g.at} y1={-8} x2={g.at} y2={PLAN_SIZE.height + 4} />
              <circle cx={g.at} cy={-11} r="3.6" />
              <text x={g.at} y={-9.8} textAnchor="middle">{g.name}</text>
            </g>
          ))}
          {GRID_Y.map((g) => (
            <g key={g.name} className="grid">
              <line x1={-8} y1={g.at} x2={PLAN_SIZE.width + 4} y2={g.at} />
              <circle cx={-11} cy={g.at} r="3.6" />
              <text x={-11} y={g.at + 1.2} textAnchor="middle">{g.name}</text>
            </g>
          ))}

          {level.areas.map((a) => {
            const t = byId.get(a.typeId);
            const color = included(a.typeId) ? colorOf(a.typeId) : '#cbd5e1';
            return (
              <g
                key={a.id}
                className="markup"
                opacity={faded(a.typeId) ? 0.12 : 1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (included(a.typeId)) pick(a.typeId);
                }}
              >
                <polygon points={pts(a.points)} fill={color} fillOpacity="0.16" stroke="none" />
                <polygon points={pts(a.points)} fill={`url(#${pid}-${color.slice(1)})`} stroke={color} strokeWidth="0.6" />
                <text x={a.label[0]} y={a.label[1] - 1.2} textAnchor="middle" className="area-name">
                  {included(a.typeId) ? t?.assemblyName : `${t?.assemblyName} (excluded)`}
                </text>
                <text x={a.label[0]} y={a.label[1] + 3} textAnchor="middle" className="area-qty">{fmt(polygonArea(a.points))} SF</text>
              </g>
            );
          })}

          {level.walls.map((w) => {
            const color = included(w.typeId) ? colorOf(w.typeId) : '#cbd5e1';
            const [mx, my] = longestSegmentMid(w.points);
            return (
              <g
                key={w.id}
                className="markup"
                opacity={faded(w.typeId) ? 0.12 : 1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (included(w.typeId)) pick(w.typeId);
                }}
              >
                <polyline points={pts(w.points)} fill="none" stroke="transparent" strokeWidth="5" />
                <polyline points={pts(w.points)} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
                <text x={mx} y={my + 0.9} textAnchor="middle" className="wall-qty">{fmt(polylineLength(w.points))} LF</text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="legend">
        <div className="legend-head">
          <h3>Legend · {level.name}</h3>
          {focus && <button className="link small" onClick={() => setFocus(null)}>Show all</button>}
        </div>
        {(['floor', 'wall'] as const).map((kind) => {
          const list = entries.filter((e) => e.kind === kind);
          if (!list.length) return null;
          return (
            <div key={kind} className="legend-group">
              <div className="legend-group-title">
                <span>{kind === 'floor' ? 'Floor assemblies' : 'Wall assemblies'}</span>
                <span>{kind === 'floor' ? 'Area' : 'Length'}</span>
              </div>
              {list.map((e) => {
                const gov = byId.get(e.govId)!;
                const open = expanded.has(e.govId);
                const children = types.filter((x) => x.parentId === e.govId);
                return (
                  <div key={e.govId} className={`legend-item${focus === e.govId ? ' focused' : ''}${focus && focus !== e.govId ? ' dim' : ''}`}>
                    <div className="legend-row">
                      <button
                        className="chev"
                        aria-label={open ? 'Collapse breakdown' : 'Expand breakdown'}
                        onClick={() => setExpanded((s) => {
                          const n = new Set(s);
                          if (n.has(e.govId)) n.delete(e.govId);
                          else n.add(e.govId);
                          return n;
                        })}
                      >
                        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <button className="legend-main" onClick={() => setFocus((f) => (f === e.govId ? null : e.govId))}>
                        {kind === 'floor' ? (
                          <svg className="legend-swatch" viewBox="0 0 16 16" aria-hidden="true">
                            <rect x="0.5" y="0.5" width="15" height="15" fill={gov.color} fillOpacity="0.16" stroke={gov.color} />
                            <rect x="0.5" y="0.5" width="15" height="15" fill={`url(#${pid}-${gov.color.slice(1)})`} />
                          </svg>
                        ) : (
                          <span className="legend-line" style={{ background: gov.color }} />
                        )}
                        <span className="legend-name">
                          {gov.assemblyName}
                          {gov.status === 'skipped' && <span className="tag">skipped</span>}
                        </span>
                        <span className="legend-qty">
                          {fmt(e.qty)} {kind === 'floor' ? 'SF' : 'LF'}
                        </span>
                      </button>
                    </div>
                    <div className="legend-sub muted small">
                      {fmt(assemblyPsf(gov.layers, materials), 1)} psf · {fmt(e.kips, 1)} kips on this level
                    </div>
                    {open && (
                      <div className="legend-breakdown">
                        <table>
                          <tbody>
                            {gov.layers.map((l) => (
                              <tr key={l.id}>
                                <td>{l.thickness ? fmtIn(l.thickness) : ''}</td>
                                <td>{materials.find((m) => m.id === l.materialId)?.name}</td>
                                <td className="num">{fmt(layerPsf(l, materials), 1)}</td>
                              </tr>
                            ))}
                            <tr className="sum">
                              <td />
                              <td>Total</td>
                              <td className="num">{fmt(assemblyPsf(gov.layers, materials), 1)} psf</td>
                            </tr>
                          </tbody>
                        </table>
                        {kind === 'wall' && <p className="muted small">Height {gov.height}' → {fmt(assemblyPsf(gov.layers, materials) * (gov.height ?? 0), 0)} plf</p>}
                        {children.length > 0 && (
                          <div className="subassemblies">
                            {children.map((c) => (
                              <div key={c.id} className="small"><GitMerge size={12} /> Sub-assembly: {c.assemblyName}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="legend-totals">
          <div><span>Floor area</span><strong>{fmt(floorSF)} SF</strong></div>
          <div><span>Wall length</span><strong>{fmt(wallLF)} LF</strong></div>
          <div><span>Dead load</span><strong>{fmt(kips, 1)} kips</strong></div>
        </div>
      </aside>
    </div>
  );
}
