"""ASCE 7-22 lookup tables used by Part 3. PRELIMINARY - every value must be checked by the EOR.

Table 12.2-1 is loaded from data/table_12_2_1.json, generated from the team-verified workbook
by scripts/build_table_json.py. All other tables are typed in here; each carries its source.
"""
import json
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data' / 'table_12_2_1.json'
RISK_CATEGORIES = ('I', 'II', 'III', 'IV')
SDC_ORDER = ('A', 'B', 'C', 'D', 'E', 'F')

# ASCE 7-22 Table 1.5-2, seismic importance factor Ie.
IE_TABLE_1_5_2 = {'I': 1.00, 'II': 1.00, 'III': 1.25, 'IV': 1.50}

# ASCE 7-22 Table 11.6-1 (SDS) and Table 11.6-2 (SD1).
# Rows: (lower bound inclusive, SDC for RC I/II/III, SDC for RC IV); first matching row from the top.
SDC_TABLE_11_6_1 = ((0.50, 'D', 'D'), (0.33, 'C', 'D'), (0.167, 'B', 'C'), (0.0, 'A', 'A'))
SDC_TABLE_11_6_2 = ((0.20, 'D', 'D'), (0.133, 'C', 'D'), (0.067, 'B', 'C'), (0.0, 'A', 'A'))
S1_SDC_E_F_THRESHOLD = 0.75  # Section 11.6: S1 >= 0.75 -> SDC E (RC I-III) or F (RC IV)

# ASCE 7-22 Table 12.8-1, Cu vs SD1. Linear interpolation between rows (common practice; EOR to confirm).
CU_TABLE_12_8_1 = ((0.4, 1.4), (0.3, 1.4), (0.2, 1.5), (0.15, 1.6), (0.1, 1.7))

# ASCE 7-22 Table 12.8-2, approximate period parameters (hn in ft).
PERIOD_TYPES = {
    'steel_mf':    {'label': 'Steel moment-resisting frames', 'Ct': 0.028, 'x': 0.8},
    'concrete_mf': {'label': 'Concrete moment-resisting frames', 'Ct': 0.016, 'x': 0.9},
    'steel_ebf':   {'label': 'Steel eccentrically braced frames (B1/D1)', 'Ct': 0.03, 'x': 0.75},
    'steel_brbf':  {'label': 'Steel buckling-restrained braced frames (B26/D13)', 'Ct': 0.03, 'x': 0.75},
    'all_other':   {'label': 'All other structural systems', 'Ct': 0.02, 'x': 0.75},
}
MOMENT_FRAME_TYPES = {'steel_mf', 'concrete_mf'}

# Default Table 12.2-1 ID -> Table 12.8-2 type. ENGINEERING JUDGMENT - EOR to review.
# Systems not listed default to 'all_other' (lowest Ta for typical heights -> conservative Cu*Ta cap).
# Ambiguous systems (C2 STMF, C8-C11 composite MF, C12 CFS-SBMF) are deliberately left as 'all_other';
# the engineer may override per direction.
DEFAULT_PERIOD_TYPE = {
    'C1': 'steel_mf', 'C3': 'steel_mf', 'C4': 'steel_mf',
    'C5': 'concrete_mf', 'C6': 'concrete_mf', 'C7': 'concrete_mf',
    'B1': 'steel_ebf', 'D1': 'steel_ebf',
    'B26': 'steel_brbf', 'D13': 'steel_brbf',
}

# Section 12.8.1.3 maximum SDS used to determine Cs.
# NOT VERIFIED against the ASCE 7-22 text. The tool warns on every use until a reviewer confirms the
# value and conditions below against the standard and sets SDS_CAP_VERIFIED = True.
SDS_CAP_12_8_1_3 = 1.0
SDS_CAP_VERIFIED = False
SDS_CAP_MAX_STORIES = 5
SDS_CAP_MAX_PERIOD_SEC = 0.5
SDS_CAP_RISK_CATEGORIES = ('I', 'II')
SDS_CAP_EXCLUDED_SITE_CLASSES = ('E', 'F')


@lru_cache(maxsize=1)
def table_12_2_1() -> dict:
    data = json.loads(DATA.read_text(encoding='utf-8'))
    return {s['id']: s for s in data['systems']}


def table_12_2_1_meta() -> dict:
    data = json.loads(DATA.read_text(encoding='utf-8'))
    return {k: v for k, v in data.items() if k != 'systems'}


def _from_table(table, value, rc):
    for lower, sdc_low, sdc_iv in table:
        if value >= lower:
            return sdc_iv if rc == 'IV' else sdc_low
    raise ValueError('Negative spectral value')


def sdc_from_sds(sds, rc): return _from_table(SDC_TABLE_11_6_1, sds, rc)
def sdc_from_sd1(sd1, rc): return _from_table(SDC_TABLE_11_6_2, sd1, rc)


def seismic_design_category(sds, sd1, s1, rc) -> dict:
    """Section 11.6: more severe of Tables 11.6-1 and 11.6-2; S1 >= 0.75 overrides to E/F.
    The Section 11.6 exception (SDC from Table 11.6-1 alone) is NOT applied - conservative."""
    a, b = sdc_from_sds(sds, rc), sdc_from_sd1(sd1, rc)
    sdc = max(a, b, key=SDC_ORDER.index)
    basis = f'Table 11.6-1 -> {a}; Table 11.6-2 -> {b}'
    if s1 >= S1_SDC_E_F_THRESHOLD:
        sdc = 'F' if rc == 'IV' else 'E'
        basis += f'; S1 = {s1:g}g >= 0.75g -> {sdc}'
    return {'sdc': sdc, 'sdc_sds': a, 'sdc_sd1': b, 'basis': basis}


def cu(sd1: float) -> float:
    pts = CU_TABLE_12_8_1
    if sd1 >= pts[0][0]:
        return pts[0][1]
    if sd1 <= pts[-1][0]:
        return pts[-1][1]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        if x2 <= sd1 <= x1:
            return y2 + (y1 - y2) * (sd1 - x2) / (x1 - x2)
    raise AssertionError('unreachable')
