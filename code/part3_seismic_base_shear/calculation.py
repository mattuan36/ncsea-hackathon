"""PRELIMINARY ASCE 7-22 Section 12.8 ELF seismic response coefficient Cs, per orthogonal direction.

Implements: Ie (Table 1.5-2), SDC (Section 11.6), R/Omega0/Cd lookup and system limits (Table 12.2-1),
combinations of systems (Section 12.2.3), period cap T <= Cu*Ta (Section 12.8.2, Tables 12.8-1/12.8-2),
Cs bounds (Section 12.8.1.1), optional maximum-SDS provision (Section 12.8.1.3), V = Cs W.

NOT checked: ELF eligibility (Table 12.6-1 / irregularities), redundancy, two-stage analysis,
Section 12.2.5.4 height increases, vertical distribution. Warnings never block the calculation.
"""
from typing import Literal
from pydantic import BaseModel, Field, model_validator
import code_tables as ct

TOL = 1e-12
PeriodType = Literal['steel_mf', 'concrete_mf', 'steel_ebf', 'steel_brbf', 'all_other']


class DirectionInput(BaseModel):
    direction: Literal['X', 'Y']
    combination: Literal['single', 'horizontal', 'vertical'] = 'single'
    # single: [id]; horizontal: 2-4 ids in the same direction; vertical: [upper_id, lower_id]
    system_ids: list[str] = Field(min_length=1, max_length=4)
    period_analysis_sec: float | None = Field(default=None, gt=0, le=30)
    period_type_override: PeriodType | None = None
    # Table 12.8-2 moment-frame Ct applies only if frames resist 100% of the seismic force and are not
    # enclosed/adjoined by more rigid components. Engineer must confirm, else 'all_other' is used.
    moment_frames_resist_100pct: bool = False

    @model_validator(mode='after')
    def _check(self):
        n = len(self.system_ids)
        if self.combination == 'single' and n != 1:
            raise ValueError(f'{self.direction}: single system requires exactly 1 system ID')
        if self.combination == 'horizontal' and not 2 <= n <= 4:
            raise ValueError(f'{self.direction}: horizontal combination requires 2-4 system IDs')
        if self.combination == 'vertical' and n != 2:
            raise ValueError(f'{self.direction}: vertical combination requires [upper, lower] system IDs')
        bad = [s for s in self.system_ids if s not in ct.table_12_2_1()]
        if bad:
            raise ValueError(f'{self.direction}: unknown Table 12.2-1 system ID(s): {", ".join(bad)}')
        return self


class SeismicInput(BaseModel):
    project_number: str = Field(default='', max_length=80)
    asce_edition: Literal['7-22'] = '7-22'
    source_status: str = Field(default='MANUAL_UNVERIFIED', max_length=70)
    sds: float = Field(ge=0, le=10)
    sd1: float = Field(ge=0, le=10)
    s1: float = Field(ge=0, le=10)
    tl: float = Field(gt=0, le=100)
    risk_category: Literal['I', 'II', 'III', 'IV']
    site_class: str = Field(default='', max_length=10)
    part1_sdc: str = Field(default='', max_length=2)
    hn_ft: float = Field(gt=0, le=3000)
    stories_above_base: int | None = Field(default=None, ge=1, le=300)
    weight_kips: float | None = Field(default=None, gt=0, le=1e9)
    directions: list[DirectionInput] = Field(min_length=2, max_length=2)
    # Section 12.8.1.3 (optional). Regularity and rho = 1.0 are engineer-confirmed (irregularity checks out of scope).
    apply_sds_cap_12_8_1_3: bool = False
    confirm_regular_no_irregularities: bool = False
    confirm_rho_equals_1: bool = False
    engineer_reviewed: bool = False

    @model_validator(mode='after')
    def _dirs(self):
        if sorted(d.direction for d in self.directions) != ['X', 'Y']:
            raise ValueError('Provide exactly one X and one Y direction')
        return self


def cs_bounds(sds, sd1, s1, tl, r, ie, t) -> dict:
    """Section 12.8.1.1, Eqs. 12.8-2 through 12.8-6."""
    den = r / ie
    cs_short = sds / den
    cs_upper = sd1 / (t * den) if t <= tl else sd1 * tl / (t ** 2 * den)
    min_044 = max(0.044 * sds * ie, 0.01)
    min_s1 = 0.5 * s1 / den if s1 >= 0.6 else 0.0
    cs_min = max(min_044, min_s1)
    raw = min(cs_short, cs_upper)
    cs = max(raw, cs_min)
    gov = ('Minimum Cs' if cs_min > raw + TOL else
           'Period upper limit' if cs_upper < cs_short - TOL else 'SDS/(R/Ie)')
    return {'r_over_ie': den, 'cs_short': cs_short, 'cs_upper': cs_upper, 'cs_min_044': min_044,
            'cs_min_high_s1': min_s1, 'cs_min': cs_min, 'cs': cs, 'governing': gov}


def _resolve_coefficients(d: DirectionInput, warn: list) -> dict:
    """Section 12.2.3 combination rules -> design R, Omega0, Cd."""
    tab = ct.table_12_2_1()
    sys = [tab[i] for i in d.system_ids]
    if d.combination == 'vertical':
        up, lo = sys
        if lo['R'] < up['R']:
            base = lo; amp = up['R'] / lo['R']
            rule = ('12.2.3.1 (vertical): lower system has lower R - each system uses its own R/Omega0/Cd; '
                    f'forces transferred from upper to lower system x {amp:.3f} (R_upper/R_lower).')
        else:
            base = up; amp = 1.0
            rule = '12.2.3.1 (vertical): upper system has lower or equal R - upper R/Omega0/Cd used for both systems.'
        warn.append(f'{d.direction}: vertical combination - 12.2.3.1 exceptions and 12.2.3.2 two-stage '
                    'analysis are not evaluated; confirm the combination rule applies.')
        return {'R': base['R'], 'omega0': base['omega0'], 'Cd': base['Cd'], 'rule': rule,
                'upper': {'R': up['R'], 'omega0': up['omega0'], 'Cd': up['Cd']},
                'transfer_amplification': amp}
    r = min(s['R'] for s in sys)
    gov = [s for s in sys if abs(s['R'] - r) < TOL]
    om, cd = max(s['omega0'] for s in gov), max(s['Cd'] for s in gov)
    rule = 'Single system.'
    if d.combination == 'horizontal':
        rule = ('12.2.3.3 (same direction): least R governs; Omega0 and Cd taken as the largest values '
                'among systems with that R. Most stringent Table 12.2-1 limitations apply.')
        om_all, cd_all = max(s['omega0'] for s in sys), max(s['Cd'] for s in sys)
        if om_all > om + TOL or cd_all > cd + TOL:
            warn.append(f'{d.direction}: another system in this direction has a larger Omega0 ({om_all:g}) or '
                        f'Cd ({cd_all:g}) than the governing-R system. Confirm interpretation of 12.2.3.3.')
        warn.append(f'{d.direction}: 12.2.3.3 exception (least R per independent line of resistance) not evaluated.')
    return {'R': r, 'omega0': om, 'Cd': cd, 'rule': rule, 'upper': None, 'transfer_amplification': None}


def _system_limits(d: DirectionInput, sdc: str, hn: float, warn: list) -> list:
    out = []
    for sid in d.system_ids:
        s = ct.table_12_2_1()[sid]
        if sdc == 'A':
            out.append({'id': sid, 'limit_ft': None, 'status': 'SDC A - Table 12.2-1 limits n/a'})
            continue
        lim = s['height_limits_ft'][sdc]
        tag = f"{d.direction}: {sid} {s['name']}"
        if lim == 'NP':
            status = 'NOT PERMITTED'
            warn.append(f'{tag} is NOT PERMITTED in SDC {sdc} (Table 12.2-1).')
        elif lim == 'NL':
            status = 'OK (not limited)'
        elif hn > lim + TOL:
            status = f'EXCEEDS {lim:g} ft'
            msg = f'{tag}: hn = {hn:g} ft exceeds the {lim:g} ft limit for SDC {sdc} (Table 12.2-1).'
            if sdc in ('D', 'E', 'F') and lim in (160.0, 100.0):
                msg += ' Section 12.2.5.4 increases may apply - not evaluated.'
            warn.append(msg)
        else:
            status = f'OK (<= {lim:g} ft)'
        if 'q' in s['system_footnotes'] and hn < 60 - TOL:
            warn.append(f'{tag}: footnote q - structural height shall not be less than 60 ft; hn = {hn:g} ft.')
        fn = s['other_footnotes']
        if fn and (':' not in fn or sdc in fn.split(':')[0]):
            warn.append(f"{tag}: Table 12.2-1 footnote(s) apply ({s['other_footnotes']}); review.")
        out.append({'id': sid, 'name': s['name'], 'limit_ft': lim, 'status': status})
    return out


def _period_type(d: DirectionInput, warn: list) -> str:
    if d.period_type_override:
        warn.append(f'{d.direction}: Table 12.8-2 structure type overridden by engineer to '
                    f'"{ct.PERIOD_TYPES[d.period_type_override]["label"]}".')
        return d.period_type_override
    types = {ct.DEFAULT_PERIOD_TYPE.get(i, 'all_other') for i in d.system_ids}
    if len(types) > 1:
        warn.append(f'{d.direction}: systems map to different Table 12.8-2 types; "all other" used.')
        return 'all_other'
    pt = types.pop()
    if pt in ct.MOMENT_FRAME_TYPES and not d.moment_frames_resist_100pct:
        warn.append(f'{d.direction}: moment-frame Ct/x not used because the engineer has not confirmed frames '
                    'resist 100% of the seismic force and are not enclosed by more rigid components; "all other" used.')
        return 'all_other'
    return pt


def calculate(i: SeismicInput) -> dict:
    warn: list[str] = []
    ie = ct.IE_TABLE_1_5_2[i.risk_category]
    sdc = ct.seismic_design_category(i.sds, i.sd1, i.s1, i.risk_category)
    warn.append('SDC computed from Tables 11.6-1/11.6-2 without the Section 11.6 exception (conservative).')
    if i.part1_sdc and i.part1_sdc.strip().upper() != sdc['sdc']:
        warn.append(f"SDC MISMATCH: Part 1 reports SDC {i.part1_sdc.strip().upper()}, Part 3 computes SDC "
                    f"{sdc['sdc']} ({sdc['basis']}). Resolve before use.")
    if sdc['sdc'] == 'A':
        warn.append('SDC A: Section 11.7 governs; ELF base shear per Section 12.8 may not be required.')
    cu_val = ct.cu(i.sd1)
    ts = i.sd1 / i.sds if i.sds > 0 else None

    dirs = {}
    for d in sorted(i.directions, key=lambda x: x.direction):
        coef = _resolve_coefficients(d, warn)
        limits = _system_limits(d, sdc['sdc'], i.hn_ft, warn)
        pt = _period_type(d, warn)
        ctv, xv = ct.PERIOD_TYPES[pt]['Ct'], ct.PERIOD_TYPES[pt]['x']
        ta = ctv * i.hn_ft ** xv
        cap = cu_val * ta
        if d.period_analysis_sec is None:
            t_used, t_basis = ta, 'Ta (no analysis period provided)'
        elif d.period_analysis_sec > cap + TOL:
            t_used, t_basis = cap, f'Cu*Ta cap (analysis T = {d.period_analysis_sec:g} s exceeds Cu*Ta)'
        else:
            t_used, t_basis = d.period_analysis_sec, 'Analysis period (<= Cu*Ta)'
        if d.period_analysis_sec is not None and d.period_analysis_sec > cap + TOL:
            warn.append(f'{d.direction}: analysis period {d.period_analysis_sec:g} s capped at Cu*Ta = {cap:.3f} s '
                        '(Section 12.8.2). Drift per 12.8.6.2 may use the analysis period.')

        # Section 12.8.1.3
        sds_used, cap_status = i.sds, 'Not requested'
        if i.apply_sds_cap_12_8_1_3:
            fails = []
            if not i.confirm_regular_no_irregularities: fails.append('regularity not confirmed')
            if not i.confirm_rho_equals_1: fails.append('rho = 1.0 not confirmed')
            if i.stories_above_base is None or i.stories_above_base > ct.SDS_CAP_MAX_STORIES:
                fails.append(f'stories above base not <= {ct.SDS_CAP_MAX_STORIES}')
            if t_used > ct.SDS_CAP_MAX_PERIOD_SEC + TOL: fails.append(f'T > {ct.SDS_CAP_MAX_PERIOD_SEC} s')
            if i.risk_category not in ct.SDS_CAP_RISK_CATEGORIES: fails.append('Risk Category not I or II')
            sc = i.site_class.strip().upper()
            if not sc or sc in ct.SDS_CAP_EXCLUDED_SITE_CLASSES: fails.append('Site Class missing, E or F')
            if fails:
                cap_status = 'Not applied: ' + '; '.join(fails)
            else:
                sds_used = min(i.sds, ct.SDS_CAP_12_8_1_3)
                cap_status = f'Applied: SDS for Cs = min(SDS, {ct.SDS_CAP_12_8_1_3:g})'
                if not ct.SDS_CAP_VERIFIED:
                    warn.append(f'{d.direction}: Section 12.8.1.3 cap value and conditions in this tool are NOT '
                                'VERIFIED against ASCE 7-22 text. Do not rely on the reduced Cs until checked.')

        base = cs_bounds(sds_used, i.sd1, i.s1, i.tl, coef['R'], ie, t_used)
        upper = (cs_bounds(sds_used, i.sd1, i.s1, i.tl, coef['upper']['R'], ie, t_used)
                 if coef['upper'] else None)
        if base['cs_min'] > base['cs_upper'] + TOL:
            warn.append(f'{d.direction}: minimum Cs exceeds the period-dependent upper limit; minimum controls.')
        if ts and sdc['sdc'] in ('D', 'E', 'F') and t_used >= 3.5 * ts - TOL:
            warn.append(f'{d.direction}: T = {t_used:.3f} s >= 3.5Ts = {3.5 * ts:.3f} s; ELF may not be permitted '
                        '(Table 12.6-1). Confirm.')
        w = i.weight_kips
        dirs[d.direction] = {
            'combination': d.combination, 'system_ids': d.system_ids, 'combination_rule': coef['rule'],
            'R': coef['R'], 'omega0': coef['omega0'], 'Cd': coef['Cd'],
            'upper_system': coef['upper'], 'transfer_amplification': coef['transfer_amplification'],
            'system_limits': limits, 'period_type': pt, 'period_type_label': ct.PERIOD_TYPES[pt]['label'],
            'Ct': ctv, 'x': xv, 'Ta': ta, 'Cu': cu_val, 'CuTa': cap,
            'period_analysis_sec': d.period_analysis_sec, 'T_used': t_used, 'T_basis': t_basis,
            'sds_used': sds_used, 'sds_cap_status': cap_status, **base,
            'cs_upper_system': upper['cs'] if upper else None,
            'base_shear_kips': None if w is None else base['cs'] * w,
            'base_shear_lbs': None if w is None else base['cs'] * w * 1000,
            'symbolic_base_shear': f"V = {base['cs']:.5f} x W",
        }

    notes = ['PRELIMINARY ASCE 7-22 ELF calculation. Engineer must confirm ELF eligibility (Table 12.6-1), '
             'all inputs, and system selection. Not a structural analysis.',
             'Irregularities, redundancy, 12.2.5.4 height increases and vertical distribution are not checked.']
    if i.source_status == 'SYNTHETIC_DEMO':
        notes.insert(0, 'SYNTHETIC DATA - NOT FOR DESIGN OR CONSTRUCTION.')
    elif not i.engineer_reviewed:
        notes.insert(0, 'ENGINEER REVIEW NOT CONFIRMED - NOT FOR DESIGN.')
    if i.weight_kips is None:
        notes.append('Numerical V is not available until the engineer supplies effective seismic weight W.')
    return {'ie': ie, 'sdc': sdc['sdc'], 'sdc_basis': sdc['basis'], 'ts': ts, 'cu': cu_val,
            'weight_kips': i.weight_kips, 'directions': dirs, 'warnings': warn, 'notes': notes,
            'engineer_reviewed': i.engineer_reviewed}
