import katex from 'katex';
import 'katex/dist/katex.min.css';
import './equation.css';

export interface Formula {
  id: string;
  label: string;
  tex: string;
  plain: string;
  note?: string;
  active?: boolean;
  /** Span the row so a long expression is not clipped. */
  wide?: boolean;
}

/** Render one TeX expression. `plain` is the accessible reading of the same equation. */
export function Equation({ tex, plain, display = false }: { tex: string; plain: string; display?: boolean }) {
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: display,
    output: 'html',
    strict: 'ignore',
    trust: false,
  });
  return (
    <span
      className={display ? 'eq-display' : 'eq-inline'}
      role="img"
      aria-label={plain}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function FormulaList({ formulas }: { formulas: Formula[] }) {
  return (
    <div className="eq-list">
      {formulas.map((formula) => (
        <div key={formula.id} className={`eq-row${formula.active ? ' active' : ''}${formula.wide ? ' wide' : ''}`}>
          <div className="eq-label">
            <span>{formula.label}</span>
            {formula.active && <span className="status done">Governs</span>}
          </div>
          <Equation tex={formula.tex} plain={formula.plain} display />
          {formula.note && <p className="eq-note">{formula.note}</p>}
        </div>
      ))}
    </div>
  );
}

function finite(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function texNum(value: number, digits: number): string {
  return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

function close(a: number, b: number, tolerance = 0.0006): boolean {
  return Math.abs(a - b) <= tolerance;
}

export interface SiteQuantities {
  ss?: unknown;
  s1?: unknown;
  fa?: unknown;
  fv?: unknown;
  sms?: unknown;
  sm1?: unknown;
  sds?: unknown;
  sd1?: unknown;
  ts?: unknown;
  t0?: unknown;
}

/** ASCE 7 Section 11.4 site coefficients, filled with reported values when the report has them. */
export function siteFormulas(seismic: SiteQuantities): Formula[] {
  const ss = finite(seismic.ss);
  const s1 = finite(seismic.s1);
  const fa = finite(seismic.fa);
  const fv = finite(seismic.fv);
  const sms = finite(seismic.sms);
  const sm1 = finite(seismic.sm1);
  const sds = finite(seismic.sds);
  const sd1 = finite(seismic.sd1);
  const ts = finite(seismic.ts);
  const t0 = finite(seismic.t0);
  const agrees = (left: number, right: number) => close(left, right, 0.006);
  const product = (a: number | null, b: number | null, reported: number | null) =>
    a != null && b != null && reported != null && agrees(a * b, reported);

  const smsTex = sms == null
    ? String.raw`S_{MS} = F_a S_S`
    : product(fa, ss, sms)
      ? String.raw`S_{MS} = F_a S_S = (${texNum(fa!, 3)})(${texNum(ss!, 3)}) = ${texNum(sms, 3)}\,\mathrm{g}`
      : String.raw`S_{MS} = F_a S_S = ${texNum(sms, 3)}\,\mathrm{g}`;
  const sm1Tex = sm1 == null
    ? String.raw`S_{M1} = F_v S_1`
    : product(fv, s1, sm1)
      ? String.raw`S_{M1} = F_v S_1 = (${texNum(fv!, 3)})(${texNum(s1!, 3)}) = ${texNum(sm1, 3)}\,\mathrm{g}`
      : String.raw`S_{M1} = F_v S_1 = ${texNum(sm1, 3)}\,\mathrm{g}`;
  const sdsTex = sds == null
    ? String.raw`S_{DS} = \tfrac{2}{3} S_{MS}`
    : sms != null && agrees((2 / 3) * sms, sds)
      ? String.raw`S_{DS} = \tfrac{2}{3} S_{MS} = \tfrac{2}{3}(${texNum(sms, 3)}) = ${texNum(sds, 3)}\,\mathrm{g}`
      : String.raw`S_{DS} = \tfrac{2}{3} S_{MS} = ${texNum(sds, 3)}\,\mathrm{g}`;
  const sd1Tex = sd1 == null
    ? String.raw`S_{D1} = \tfrac{2}{3} S_{M1}`
    : sm1 != null && agrees((2 / 3) * sm1, sd1)
      ? String.raw`S_{D1} = \tfrac{2}{3} S_{M1} = \tfrac{2}{3}(${texNum(sm1, 3)}) = ${texNum(sd1, 3)}\,\mathrm{g}`
      : String.raw`S_{D1} = \tfrac{2}{3} S_{M1} = ${texNum(sd1, 3)}\,\mathrm{g}`;
  const tsTex = ts == null
    ? String.raw`T_S = S_{D1} / S_{DS}`
    : sds != null && sd1 != null && sds !== 0 && agrees(sd1 / sds, ts)
      ? String.raw`T_S = \frac{S_{D1}}{S_{DS}} = \frac{${texNum(sd1, 3)}}{${texNum(sds, 3)}} = ${texNum(ts, 3)}\,\mathrm{s}`
      : String.raw`T_S = \frac{S_{D1}}{S_{DS}} = ${texNum(ts, 3)}\,\mathrm{s}`;
  const t0Tex = t0 == null
    ? String.raw`T_0 = 0.2\, T_S`
    : ts != null && agrees(0.2 * ts, t0)
      ? String.raw`T_0 = 0.2\, T_S = 0.2(${texNum(ts, 3)}) = ${texNum(t0, 3)}\,\mathrm{s}`
      : String.raw`T_0 = 0.2\, T_S = ${texNum(t0, 3)}\,\mathrm{s}`;

  return [
    { id: 'sms', label: '11.4.3', tex: smsTex, plain: sms == null ? 'SMS = Fa times Ss' : `SMS = Fa times Ss = ${texNum(sms, 3)} g` },
    { id: 'sm1', label: '11.4.3', tex: sm1Tex, plain: sm1 == null ? 'SM1 = Fv times S1' : `SM1 = Fv times S1 = ${texNum(sm1, 3)} g` },
    { id: 'sds', label: '11.4.5', tex: sdsTex, plain: sds == null ? 'SDS = (2/3) SMS' : `SDS = (2/3) SMS = ${texNum(sds, 3)} g` },
    { id: 'sd1', label: '11.4.5', tex: sd1Tex, plain: sd1 == null ? 'SD1 = (2/3) SM1' : `SD1 = (2/3) SM1 = ${texNum(sd1, 3)} g` },
    { id: 'ts', label: '11.4.6', tex: tsTex, plain: ts == null ? 'Ts = SD1 / SDS' : `Ts = SD1 / SDS = ${texNum(ts, 3)} s` },
    { id: 't0', label: '11.4.6', tex: t0Tex, plain: t0 == null ? 'T0 = 0.2 Ts' : `T0 = 0.2 Ts = ${texNum(t0, 3)} s` },
  ];
}

export interface CsDisplay {
  sds: number;
  sd1: number;
  s1: number;
  tl: number;
  r: number;
  ie: number;
  t: number;
  cs: number;
  governing: string;
  weight: number | null;
  ta?: number;
  cuTa?: number;
}

/** ASCE 7-22 Section 12.8.1.1. Numeric lines are the equation values; only the governing line is marked. */
export function csFormulas(input: CsDisplay | null): Formula[] {
  if (!input) {
    return [
      { id: 'short', label: 'Eq. 12.8-2', tex: String.raw`C_s = \frac{S_{DS}}{R/I_e}`, plain: 'Cs = SDS / (R/Ie)' },
      { id: 'upper3', label: 'Eq. 12.8-3', tex: String.raw`C_s \le \frac{S_{D1}}{T\,(R/I_e)} \quad (T \le T_L)`, plain: 'Cs need not exceed SD1 / [T (R/Ie)] when T ≤ TL' },
      { id: 'upper4', label: 'Eq. 12.8-4', tex: String.raw`C_s \le \frac{S_{D1}\, T_L}{T^{2}\,(R/I_e)} \quad (T > T_L)`, plain: 'Cs need not exceed SD1 TL / [T² (R/Ie)] when T > TL' },
      { id: 'min5', label: 'Eq. 12.8-5', tex: String.raw`C_s \ge \max\!\left(0.044\, S_{DS}\, I_e,\; 0.01\right)`, plain: 'Cs shall not be less than the larger of 0.044 SDS Ie and 0.01' },
      { id: 'min6', label: 'Eq. 12.8-6', tex: String.raw`C_s \ge \frac{0.5\, S_1}{R/I_e} \quad (S_1 \ge 0.6)`, plain: 'When S1 ≥ 0.6, Cs shall not be less than 0.5 S1 / (R/Ie)' },
      { id: 'ta', label: '12.8.2', tex: String.raw`T_a = C_t h_n^{x}`, plain: 'Ta = Ct times hn to the power x' },
      { id: 'tcap', label: '12.8.2', tex: String.raw`T = \min(T_{\mathrm{analysis}},\; C_u T_a)`, plain: 'T used is the lesser of the analysis period and Cu Ta' },
      { id: 'shear', label: '12.8.1', tex: String.raw`V = C_s W`, plain: 'Base shear V = Cs W' },
    ];
  }

  const den = input.r / input.ie;
  const short = input.sds / den;
  const longPeriod = input.t > input.tl;
  const upper = longPeriod
    ? (input.sd1 * input.tl) / (input.t ** 2 * den)
    : input.sd1 / (input.t * den);
  const floor = Math.max(0.044 * input.sds * input.ie, 0.01);
  const high = input.s1 >= 0.6 ? (0.5 * input.s1) / den : 0;
  const governsMin = input.governing === 'Minimum Cs';
  const governsUpper = input.governing === 'Period upper limit';
  const governsShort = input.governing === 'SDS/(R/Ie)';
  const rIe = `${texNum(input.r, 3)}/${texNum(input.ie, 2)}`;

  const rows: Formula[] = [
    {
      id: 'short',
      label: 'Eq. 12.8-2',
      active: governsShort,
      tex: String.raw`C_s = \frac{${texNum(input.sds, 3)}}{${rIe}} = ${texNum(short, 5)}`,
      plain: `Cs = ${texNum(input.sds, 3)} / (${texNum(input.r, 3)}/${texNum(input.ie, 2)}) = ${texNum(short, 5)}`,
    },
    {
      id: 'upper3',
      label: 'Eq. 12.8-3',
      active: governsUpper && !longPeriod,
      note: longPeriod ? 'Does not apply: T > TL.' : undefined,
      tex: longPeriod
        ? String.raw`C_s \le \frac{S_{D1}}{T\,(R/I_e)} \quad (T \le T_L)`
        : String.raw`C_s \le \frac{${texNum(input.sd1, 3)}}{${texNum(input.t, 3)}\,(${rIe})} = ${texNum(upper, 5)}`,
      plain: longPeriod
        ? 'Eq. 12.8-3 does not apply because T is greater than TL'
        : `Cs need not exceed ${texNum(upper, 5)}`,
    },
    {
      id: 'upper4',
      label: 'Eq. 12.8-4',
      active: governsUpper && longPeriod,
      note: longPeriod ? undefined : 'Does not apply: T ≤ TL.',
      tex: longPeriod
        ? String.raw`C_s \le \frac{${texNum(input.sd1, 3)}\,(${texNum(input.tl, 2)})}{${texNum(input.t, 3)}^{2}\,(${rIe})} = ${texNum(upper, 5)}`
        : String.raw`C_s \le \frac{S_{D1}\, T_L}{T^{2}\,(R/I_e)} \quad (T > T_L)`,
      plain: longPeriod
        ? `Cs need not exceed ${texNum(upper, 5)}`
        : 'Eq. 12.8-4 does not apply because T is not greater than TL',
    },
    {
      id: 'min5',
      label: 'Eq. 12.8-5',
      active: governsMin && high <= floor,
      tex: String.raw`C_s \ge \max\!\left(0.044\,(${texNum(input.sds, 3)})\,(${texNum(input.ie, 2)}),\; 0.01\right) = ${texNum(floor, 5)}`,
      plain: `Cs shall not be less than ${texNum(floor, 5)}`,
    },
    {
      id: 'min6',
      label: 'Eq. 12.8-6',
      active: governsMin && high > floor,
      note: input.s1 >= 0.6 ? undefined : 'Does not apply: S1 < 0.6 g.',
      tex: input.s1 >= 0.6
        ? String.raw`C_s \ge \frac{0.5\,(${texNum(input.s1, 3)})}{${rIe}} = ${texNum(high, 5)}`
        : String.raw`C_s \ge \frac{0.5\, S_1}{R/I_e} \quad (S_1 \ge 0.6)`,
      plain: input.s1 >= 0.6
        ? `When S1 ≥ 0.6, Cs shall not be less than ${texNum(high, 5)}`
        : 'Eq. 12.8-6 does not apply because S1 is below 0.6 g',
    },
  ];

  if (input.ta != null) {
    rows.push({
      id: 'ta',
      label: '12.8.2',
      tex: String.raw`T_a = C_t h_n^{x} = ${texNum(input.ta, 3)}\,\mathrm{s}`,
      plain: `Ta = ${texNum(input.ta, 3)} seconds`,
    });
  }
  if (input.cuTa != null) {
    rows.push({
      id: 'tcap',
      label: '12.8.2',
      tex: String.raw`T = \min(T_{\mathrm{analysis}},\; C_u T_a) = ${texNum(input.t, 3)}\,\mathrm{s}`,
      plain: `Period used is ${texNum(input.t, 3)} seconds, not above Cu Ta of ${texNum(input.cuTa, 3)} seconds`,
      note: `Cu Ta = ${texNum(input.cuTa, 3)} s.`,
    });
  }
  rows.push({
    id: 'shear',
    label: '12.8.1',
    tex: input.weight == null
      ? String.raw`V = C_s W = ${texNum(input.cs, 5)}\, W`
      : String.raw`V = C_s W = (${texNum(input.cs, 5)})(${texNum(input.weight, 1)}) = ${texNum(input.cs * input.weight, 1)}\,\mathrm{kips}`,
    plain: input.weight == null
      ? `V = ${texNum(input.cs, 5)} W`
      : `V = ${texNum(input.cs, 5)} × ${texNum(input.weight, 1)} = ${texNum(input.cs * input.weight, 1)} kips`,
    note: input.weight == null ? 'W is not supplied, so base shear stays symbolic.' : undefined,
  });
  return rows;
}

export function deadLoadFormulas(wallsUseNetArea: boolean): Formula[] {
  return [
    {
      id: 'psf',
      label: 'Unit weight',
      tex: String.raw`w = \frac{\gamma\, t}{12}`,
      plain: 'psf = pcf times thickness in inches, divided by 12',
      note: 'Listed psf values are used as given. An override replaces w.',
    },
    {
      id: 'floor',
      label: 'Floors',
      tex: String.raw`P = \frac{w\, A}{1000}`,
      plain: 'Floor kips = psf times area in square feet, divided by 1000',
    },
    {
      id: 'wall',
      label: 'Walls',
      tex: wallsUseNetArea
        ? String.raw`P = \frac{w\, A_{\mathrm{net}}}{1000}`
        : String.raw`P = \frac{w\, h\, L}{1000}`,
      plain: wallsUseNetArea
        ? 'Wall kips = psf times net wall area, divided by 1000'
        : 'Wall kips = psf times height times length, divided by 1000',
      note: wallsUseNetArea ? 'Net area has openings removed.' : 'Demo geometry uses height times length.',
    },
    {
      id: 'area',
      label: 'Plan area',
      wide: true,
      tex: String.raw`A = \dfrac{1}{2}\left|\sum_{i}(x_i y_{i+1} - x_{i+1} y_i)\right|`,
      plain: 'Plan area is the shoelace formula on the polygon',
    },
  ];
}

export function csDisplayFromParts(
  parts: {
    sds: number | null;
    sd1: number | null;
    s1: number | null;
    tl: number | null;
    r: number;
    ie: number;
    t: number;
    cs: number;
    governing: string;
    weight: number | null;
    ta?: number;
    cuTa?: number;
  },
): CsDisplay | null {
  const sds = finite(parts.sds);
  const sd1 = finite(parts.sd1);
  const s1 = finite(parts.s1);
  const tl = finite(parts.tl);
  const weight = finite(parts.weight);
  if (sds == null || sds <= 0 || sd1 == null || sd1 < 0 || s1 == null || s1 < 0 || tl == null || tl <= 0) return null;
  if (![parts.r, parts.ie, parts.t, parts.cs].every((value) => Number.isFinite(value) && value > 0)) return null;
  return {
    sds,
    sd1,
    s1,
    tl,
    r: parts.r,
    ie: parts.ie,
    t: parts.t,
    cs: parts.cs,
    governing: parts.governing,
    weight,
    ta: parts.ta != null && Number.isFinite(parts.ta) ? parts.ta : undefined,
    cuTa: parts.cuTa != null && Number.isFinite(parts.cuTa) ? parts.cuTa : undefined,
  };
}
