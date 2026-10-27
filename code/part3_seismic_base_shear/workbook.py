"""Formula-driven ASCE 7-22 Cs / base-shear workbook, X and Y directions.

Every result cell is an Excel formula on the Inputs sheet, so editing inputs (hazards, Risk Category,
hn, system IDs, combination, period, W, 12.8.1.3 switches) recalculates in Excel. Numeric results are
also cached from the Python calculation so previews without recalculation show values.
Warning text on 'Review Notes' is generated at export and does NOT update when Excel inputs change.
"""
from io import BytesIO
from zipfile import ZipFile
import re
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet.datavalidation import DataValidation
from calculation import SeismicInput, calculate
import code_tables as ct

NAVY = '152942'; BLUE = '184DB5'; GREEN = '21704D'; GREY = '697B88'; ORANGE = 'A65624'
INPUT_FILL = PatternFill('solid', fgColor='EBF3FF'); RESULT_FILL = PatternFill('solid', fgColor='DDEFEA')
HEAD_FILL = PatternFill('solid', fgColor=NAVY)
T122 = "'Table 12.2-1'"; CTAB = "'Code Tables'"; IN = 'Inputs'
SDC_LIST = '{"A","B","C","D","E","F"}'
COLS = {'X': 'B', 'Y': 'C'}
NSLOTS = 4


def _safe_text(value):
    if not isinstance(value, str): return value
    if value.lstrip().startswith(('=', '+', '-', '@')): return "'" + value
    return value[:1000]


def _cache_numeric_formulas(raw: bytes, caches: dict[str, dict[str, float]]) -> bytes:
    """Write cached results for numeric formula cells (keyed by sheet XML path) without changing formulas."""
    out = BytesIO()
    with ZipFile(BytesIO(raw)) as src, ZipFile(out, 'w') as dst:
        for zi in src.infolist():
            data = src.read(zi.filename)
            if zi.filename in caches:
                xml = data.decode('utf-8')
                for addr, val in caches[zi.filename].items():
                    rx = rf'(<c\b[^>]*\br="{re.escape(addr)}"[^>]*>\s*<f[^>]*>.*?</f>\s*)(<v>[^<]*</v>|<v\s*/>)?'
                    xml, n = re.subn(rx, lambda m: m.group(1) + f'<v>{format(val, ".15g")}</v>', xml, count=1, flags=re.S)
                    if n != 1: raise RuntimeError(f'Cached formula cell missing: {zi.filename} {addr}')
                data = xml.encode('utf-8')
            dst.writestr(zi, data)
    return out.getvalue()


def _title(ws, text, span='A1:E2'):
    ws.merge_cells(span); ws['A1'] = text
    x = ws['A1']; x.fill = HEAD_FILL; x.font = Font(size=16, bold=True, color='FFFFFF')
    x.alignment = Alignment(vertical='center', indent=1)
    ws.sheet_view.showGridLines = False


def _header(ws, row, labels):
    for c, v in enumerate(labels, 1):
        x = ws.cell(row, c, v); x.font = Font(bold=True, color='FFFFFF'); x.fill = HEAD_FILL
        x.alignment = Alignment(vertical='center', wrap_text=True)


def _table_sheet(wb):
    ws = wb.create_sheet('Table 12.2-1')
    meta = ct.table_12_2_1_meta()
    _header(ws, 1, ['ID', 'Category', 'System', 'System footnotes', 'Detailing sections', 'R', 'Omega0', 'Cd',
                    'SDC B', 'SDC C', 'SDC D', 'SDC E', 'SDC F', 'Other footnotes'])
    for r, s in enumerate(ct.table_12_2_1().values(), 2):
        lim = [s['height_limits_ft'][k] for k in 'BCDEF']
        vals = [s['id'], s['category'], s['name'], ', '.join(s['system_footnotes']), s['detailing_sections'],
                s['R'], s['omega0'], s['Cd'], *lim, s['other_footnotes']]
        for c, v in enumerate(vals, 1): ws.cell(r, c, v)
    n = len(ct.table_12_2_1()) + 3
    ws.cell(n, 1, f"Source: ASCE/SEI 7-22 Table 12.2-1, from {meta['source_workbook']} "
                  f"(SHA-256 {meta['source_sha256'][:16]}...). {meta['verification']}").font = Font(italic=True, color=GREY)
    for col, w in zip('ABCDEFGHIJKLMN', [6, 28, 60, 10, 16, 7, 8, 7, 7, 7, 7, 7, 7, 18]):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = 'D2'


def _code_tables_sheet(wb):
    ws = wb.create_sheet('Code Tables'); _title(ws, 'ASCE 7-22 LOOKUP TABLES (PRELIMINARY)')
    ws['A4'] = 'Table 1.5-2 - Risk Category'; ws['B4'] = 'Ie'
    for r, (k, v) in enumerate(ct.IE_TABLE_1_5_2.items(), 5): ws.cell(r, 1, k); ws.cell(r, 2, v)
    ws['A10'] = 'Table 12.8-2 - type key'; ws['B10'] = 'Description'; ws['C10'] = 'Ct'; ws['D10'] = 'x'
    for r, (k, v) in enumerate(ct.PERIOD_TYPES.items(), 11):
        ws.cell(r, 1, k); ws.cell(r, 2, v['label']); ws.cell(r, 3, v['Ct']); ws.cell(r, 4, v['x'])
    ws['A17'] = 'Section 12.8.1.3 max SDS for Cs'; ws['B17'] = ct.SDS_CAP_12_8_1_3
    ws['A18'] = 'Cap value verified against ASCE 7-22?'; ws['B18'] = 'YES' if ct.SDS_CAP_VERIFIED else 'NO - VERIFY'
    ws['A21'] = 'Table 12.8-1 - SD1 (g)'; ws['B21'] = 'Cu'
    for r, (sd1, cu) in enumerate(ct.CU_TABLE_12_8_1, 22): ws.cell(r, 1, sd1); ws.cell(r, 2, cu)
    ws['A27'] = 'Cu is linearly interpolated between rows; constant beyond the end rows.'
    for c in ('A4', 'B4', 'A10', 'B10', 'C10', 'D10', 'A21', 'B21'): ws[c].font = Font(bold=True)
    ws.column_dimensions['A'].width = 40; ws.column_dimensions['B'].width = 50
    if not ct.SDS_CAP_VERIFIED: ws['B18'].font = Font(bold=True, color=ORANGE)


def _cu_formula(sd1):
    a = [f'{CTAB}!$A${r}' for r in range(22, 27)]; b = [f'{CTAB}!$B${r}' for r in range(22, 27)]
    seg = lambda i: f'{b[i+1]}+({b[i]}-{b[i+1]})*({sd1}-{a[i+1]})/({a[i]}-{a[i+1]})'
    return (f'=IF({sd1}>={a[1]},{b[1]},IF({sd1}>={a[2]},{seg(1)},IF({sd1}>={a[3]},{seg(2)},'
            f'IF({sd1}>{a[4]},{seg(3)},{b[4]}))))')


def build_calculation_xlsx(inp: SeismicInput, exchange_rows: list | None = None) -> bytes:
    res = calculate(inp)
    wb = Workbook(); wb.calculation = CalcProperties(calcMode='auto', fullCalcOnLoad=True, forceFullCalc=True)
    inputs = wb.active; inputs.title = 'Inputs'
    calc = wb.create_sheet('Cs & Base Shear'); received = wb.create_sheet('Imported ASCE')
    notes = wb.create_sheet('Review Notes')
    _table_sheet(wb); _code_tables_sheet(wb)
    _title(inputs, 'B&P  |  ASCE 7-22 SEISMIC ELF INPUTS (PRELIMINARY)')
    _title(calc, 'B&P  |  SEISMIC Cs & BASE SHEAR - X / Y')
    _title(received, 'IMPORTED ASCE HAZARD EXCHANGE'); _title(notes, 'ENGINEERING REVIEW & LIMITATIONS')
    for ws, widths in ((inputs, [40, 22, 22, 46]), (calc, [44, 20, 20, 10, 62]), (received, [29, 60, 10, 20])):
        for col, w in zip('ABCDE', widths): ws.column_dimensions[col].width = w

    # ---------------- Inputs: global ----------------
    _header(inputs, 4, ['PARAMETER', 'VALUE', 'UNITS', 'SOURCE / NOTE'])
    yn = lambda b: 'YES' if b else 'NO'
    g = [(5, 'Project number', _safe_text(inp.project_number), '', 'User or Part 1'),
         (6, 'ASCE 7 edition', inp.asce_edition, '', 'Part 3 supports ASCE 7-22 only'),
         (7, 'Hazard data status', inp.source_status, '', 'API retrieval is not verification'),
         (8, 'Engineer reviewed input?', yn(inp.engineer_reviewed), '', 'Explicit confirmation'),
         (9, 'SDS', inp.sds, 'g', 'Part 1 / engineer'), (10, 'SD1', inp.sd1, 'g', 'Part 1 / engineer'),
         (11, 'S1', inp.s1, 'g', 'Part 1 / engineer'), (12, 'TL', inp.tl, 'sec', 'Part 1 / engineer'),
         (13, 'Risk Category', inp.risk_category, '', 'I / II / III / IV - sets Ie and SDC'),
         (14, 'Site Class', inp.site_class, '', 'Used for 12.8.1.3 check'),
         (15, 'Part 1 reported SDC', inp.part1_sdc, '', 'Compared with computed SDC'),
         (16, 'Structural height hn', inp.hn_ft, 'ft', 'Engineer'),
         (17, 'Stories above base', inp.stories_above_base, '', 'Engineer (12.8.1.3 only)'),
         (18, 'W - effective seismic weight', inp.weight_kips, 'kips', 'Engineer supplied; not calculated'),
         (19, 'Apply Section 12.8.1.3 max SDS?', yn(inp.apply_sds_cap_12_8_1_3), '', 'YES / NO'),
         (20, 'Confirm: regular, no irregularities', yn(inp.confirm_regular_no_irregularities), '', 'Engineer confirmation (not checked)'),
         (21, 'Confirm: rho = 1.0', yn(inp.confirm_rho_equals_1), '', 'Engineer confirmation (not checked)')]
    for row, label, value, unit, origin in g:
        inputs.cell(row, 1, label); inputs.cell(row, 2, value); inputs.cell(row, 3, unit); inputs.cell(row, 4, origin)
        if row >= 13: inputs.cell(row, 2).font = Font(bold=True, color=BLUE); inputs.cell(row, 2).fill = INPUT_FILL
    input_cache = {}
    if exchange_rows:
        _header(received, 4, ['key', 'value', 'unit', 'source'])
        mapping = {}
        for rn, rr in enumerate(exchange_rows, 5):
            if len(rr) < 4: continue
            for c, v in enumerate(rr[:4], 1): received.cell(rn, c, _safe_text(v))
            mapping[str(rr[0] or '')[:80]] = rn
        for target, key, val in [(9, 'sds_g', inp.sds), (10, 'sd1_g', inp.sd1), (11, 's1_g', inp.s1), (12, 'tl_sec', inp.tl)]:
            if key in mapping:
                inputs.cell(target, 2, f"='Imported ASCE'!B{mapping[key]}").font = Font(bold=True, color=GREEN)
                inputs.cell(target, 4, 'Linked to Imported ASCE (green)')
                input_cache[f'B{target}'] = val
    else:
        received['A5'] = 'No imported XLSX'; received['B5'] = 'Values manually entered on Inputs'

    # ---------------- Inputs: per direction ----------------
    _header(inputs, 23, ['DIRECTION INPUTS', 'X', 'Y', 'NOTE'])
    drow = {'comb': 24, 'slot1': 25, 'tan': 25 + NSLOTS, 'ptype': 26 + NSLOTS}
    inputs.cell(24, 1, 'Combination'); inputs.cell(24, 4, 'single / horizontal / vertical (12.2.3)')
    for k in range(NSLOTS):
        inputs.cell(25 + k, 1, f'System {k+1} ID (Table 12.2-1)')
    inputs.cell(25, 4, 'Vertical: System 1 = UPPER, System 2 = LOWER')
    inputs.cell(drow['tan'], 1, 'Analysis period T (blank = use Ta)'); inputs.cell(drow['tan'], 4, 'sec')
    inputs.cell(drow['ptype'], 1, 'Table 12.8-2 structure type key'); inputs.cell(drow['ptype'], 4, 'See Code Tables A11:A15')
    dv_c = DataValidation(type='list', formula1='"single,horizontal,vertical"', allow_blank=False)
    dv_t = DataValidation(type='list', formula1=f'"{",".join(ct.PERIOD_TYPES)}"', allow_blank=False)
    dv_y = DataValidation(type='list', formula1='"YES,NO"'); dv_r = DataValidation(type='list', formula1='"I,II,III,IV"')
    for dv in (dv_c, dv_t, dv_y, dv_r): inputs.add_data_validation(dv)
    dv_r.add('B13'); [dv_y.add(f'B{r}') for r in (19, 20, 21)]
    for d in inp.directions:
        col = COLS[d.direction]; rd = res['directions'][d.direction]
        inputs[f'{col}24'] = d.combination; dv_c.add(f'{col}24')
        for k in range(NSLOTS):
            inputs[f'{col}{25+k}'] = d.system_ids[k] if k < len(d.system_ids) else None
        inputs[f'{col}{drow["tan"]}'] = d.period_analysis_sec
        inputs[f'{col}{drow["ptype"]}'] = rd['period_type']; dv_t.add(f'{col}{drow["ptype"]}')
        for r in range(24, drow['ptype'] + 1):
            inputs[f'{col}{r}'].font = Font(bold=True, color=BLUE); inputs[f'{col}{r}'].fill = INPUT_FILL

    # ---------------- Calculation sheet ----------------
    I = lambda r: f'{IN}!$B${r}'
    SDS, SD1, S1, TL, RC, SC, P1, HN, NST, W = (I(r) for r in (9, 10, 11, 12, 13, 14, 15, 16, 17, 18))
    cache = {}
    _header(calc, 4, ['GLOBAL', 'VALUE', '', 'UNITS', 'FORMULA / REFERENCE'])
    glob = [
        (5, 'Ie', f'=INDEX({CTAB}!$B$5:$B$8,MATCH({RC},{CTAB}!$A$5:$A$8,0))', '', 'Table 1.5-2', res['ie']),
        (6, 'SDC from SDS', f'=IF({SDS}>=0.5,"D",IF({SDS}>=0.33,IF({RC}="IV","D","C"),IF({SDS}>=0.167,IF({RC}="IV","C","B"),"A")))', '', 'Table 11.6-1', None),
        (7, 'SDC from SD1', f'=IF({SD1}>=0.2,"D",IF({SD1}>=0.133,IF({RC}="IV","D","C"),IF({SD1}>=0.067,IF({RC}="IV","C","B"),"A")))', '', 'Table 11.6-2', None),
        (8, 'SDC (governing)', f'=IF({S1}>=0.75,IF({RC}="IV","F","E"),IF(MATCH(B6,{SDC_LIST},0)>=MATCH(B7,{SDC_LIST},0),B6,B7))', '', 'Section 11.6; 11.6 exception NOT applied', None),
        (9, 'SDC check vs Part 1', f'=IF({P1}="","No Part 1 SDC",IF({P1}=B8,"Matches Part 1","MISMATCH - resolve"))', '', 'Warning only', None),
        (10, 'Cu', _cu_formula(SD1), '', 'Table 12.8-1 (interpolated)', res['cu']),
        (11, 'Ts = SD1/SDS', f'=IF({SDS}>0,{SD1}/{SDS},"")', 'sec', 'Section 11.4', res['ts']),
    ]
    for row, label, f, unit, ref, val in glob:
        calc.cell(row, 1, label); calc.cell(row, 2, f); calc.cell(row, 4, unit); calc.cell(row, 5, ref)
        if val is not None: cache[f'B{row}'] = val
    IE, SDC, CU = '$B$5', '$B$8', '$B$10'

    _header(calc, 13, ['BY DIRECTION', 'X', 'Y', 'UNITS', 'FORMULA / REFERENCE'])
    row = 14
    labels = {}  # name -> row
    def put(name, label, unit, ref, fx, fmt='0.00000'):
        nonlocal row
        calc.cell(row, 1, label); calc.cell(row, 4, unit); calc.cell(row, 5, ref)
        for d in ('X', 'Y'):
            c = calc[f'{COLS[d]}{row}']; c.value = fx(d, COLS[d]); c.number_format = fmt
        labels[name] = row; row += 1
    ref = lambda name, col: f'{col}{labels[name]}'
    MATCH_ID = lambda idc: f'MATCH({idc},{T122}!$A:$A,0)'
    for k in range(1, NSLOTS + 1):
        idr = 24 + k
        idc = lambda col, idr=idr: f'{IN}!{col}${idr}'
        put(f'id{k}', f'System {k} ID', '', 'Inputs', lambda d, col, idc=idc: f'=IF({idc(col)}="","",{idc(col)})', '@')
        for nm, tcol in (('R', 'F'), ('Om', 'G'), ('Cd', 'H')):
            put(f'{nm}{k}', f'  System {k} {"Omega0" if nm=="Om" else nm}', '', 'Table 12.2-1',
                lambda d, col, k=k, tcol=tcol: f'=IF({ref(f"id{k}",col)}="","",INDEX({T122}!${tcol}:${tcol},{MATCH_ID(ref(f"id{k}",col))}))', '0.00')
        put(f'lim{k}', f'  System {k} height limit at SDC', 'ft', 'Table 12.2-1 (NL/NP)',
            lambda d, col, k=k: f'=IF(OR({ref(f"id{k}",col)}="",{SDC}="A"),"",INDEX({T122}!$I:$M,{MATCH_ID(ref(f"id{k}",col))},MATCH({SDC},{{"B","C","D","E","F"}},0)))', '0')
        put(f'st{k}', f'  System {k} limit status', '', 'Warning only; 12.2.5.4 not evaluated',
            lambda d, col, k=k: (f'=IF({ref(f"lim{k}",col)}="","",IF({ref(f"lim{k}",col)}="NP","NOT PERMITTED",'
                                 f'IF({ref(f"lim{k}",col)}="NL","OK",IF({HN}>{ref(f"lim{k}",col)},"EXCEEDS LIMIT","OK"))))'), '@')
    comb = lambda col: f'{IN}!{col}$24'
    Rs = lambda col: ','.join(ref(f'R{k}', col) for k in range(1, NSLOTS + 1))
    put('R', 'R (design, base/lower system)', '', '12.2.3: least R; vertical = MIN(upper, lower)', lambda d, c: f'=MIN({Rs(c)})', '0.00')
    def maxgov(nm, c):
        parts = ','.join(f'IF({ref(f"R{k}",c)}={ref("R",c)},{ref(f"{nm}{k}",c)},0)' for k in range(1, NSLOTS + 1))
        return (f'=IF({comb(c)}="vertical",IF({ref("R2",c)}<{ref("R1",c)},{ref(f"{nm}2",c)},{ref(f"{nm}1",c)}),MAX({parts}))')
    put('Om', 'Omega0 (design, base/lower system)', '', '12.2.3.1 / 12.2.3.3', lambda d, c: maxgov('Om', c), '0.00')
    put('Cd', 'Cd (design, base/lower system)', '', '12.2.3.1 / 12.2.3.3', lambda d, c: maxgov('Cd', c), '0.00')
    put('Ru', 'R (upper system, vertical only)', '', '12.2.3.1', lambda d, c: f'=IF({comb(c)}="vertical",{ref("R1",c)},"")', '0.00')
    put('amp', 'Transfer force amplification upper->lower', '', '12.2.3.1: R_upper/R_lower if lower R is less',
        lambda d, c: f'=IF({comb(c)}="vertical",IF({ref("R2",c)}<{ref("R1",c)},{ref("R1",c)}/{ref("R2",c)},1),"")', '0.000')
    ptype = lambda c: f'{IN}!{c}${drow["ptype"]}'
    put('Ct', 'Ct', '', 'Table 12.8-2', lambda d, c: f'=INDEX({CTAB}!$C$11:$C$15,MATCH({ptype(c)},{CTAB}!$A$11:$A$15,0))', '0.000')
    put('x', 'x', '', 'Table 12.8-2', lambda d, c: f'=INDEX({CTAB}!$D$11:$D$15,MATCH({ptype(c)},{CTAB}!$A$11:$A$15,0))', '0.00')
    put('Ta', 'Ta = Ct hn^x', 'sec', 'Eq. 12.8-8 form; hn in ft', lambda d, c: f'={ref("Ct",c)}*{HN}^{ref("x",c)}', '0.000')
    put('CuTa', 'Cu Ta (period cap)', 'sec', 'Section 12.8.2', lambda d, c: f'={CU}*{ref("Ta",c)}', '0.000')
    tan = lambda c: f'{IN}!{c}${drow["tan"]}'
    put('T', 'T used for Cs', 'sec', 'Analysis T capped at Cu Ta; Ta if no analysis T',
        lambda d, c: f'=IF({tan(c)}="",{ref("Ta",c)},MIN({tan(c)},{ref("CuTa",c)}))', '0.000')
    put('capok', '12.8.1.3 max SDS applies?', '', 'All conditions + engineer confirmations',
        lambda d, c: (f'=IF(AND({I(19)}="YES",{I(20)}="YES",{I(21)}="YES",{NST}<>"",{NST}<={ct.SDS_CAP_MAX_STORIES},'
                      f'OR({RC}="I",{RC}="II"),{SC}<>"",{SC}<>"E",{SC}<>"F",{ref("T",c)}<={ct.SDS_CAP_MAX_PERIOD_SEC}),"YES","NO")'), '@')
    put('SDSu', 'SDS used for Cs', 'g', '12.8.1.3 cap (Code Tables B17) - VERIFY',
        lambda d, c: f'=IF({ref("capok",c)}="YES",MIN({SDS},{CTAB}!$B$17),{SDS})', '0.000')
    put('RIe', 'R / Ie', '', '', lambda d, c: f'={ref("R",c)}/{IE}', '0.000')
    put('cs_s', 'Cs = SDS/(R/Ie)', '', 'Eq. 12.8-2', lambda d, c: f'={ref("SDSu",c)}/{ref("RIe",c)}')
    put('cs_u', 'Cs upper limit', '', 'Eq. 12.8-3 (T<=TL) / 12.8-4 (T>TL)',
        lambda d, c: f'=IF({ref("T",c)}<={TL},{SD1}/({ref("T",c)}*{ref("RIe",c)}),{SD1}*{TL}/({ref("T",c)}^2*{ref("RIe",c)}))')
    put('cs_m1', 'Cs min = max(0.044 SDS Ie, 0.01)', '', 'Eq. 12.8-5', lambda d, c: f'=MAX(0.044*{ref("SDSu",c)}*{IE},0.01)')
    put('cs_m2', 'Cs min (S1 >= 0.6g) = 0.5 S1/(R/Ie)', '', 'Eq. 12.8-6', lambda d, c: f'=IF({S1}>=0.6,0.5*{S1}/{ref("RIe",c)},0)')
    put('cs_min', 'Cs minimum (controlling)', '', '', lambda d, c: f'=MAX({ref("cs_m1",c)},{ref("cs_m2",c)})')
    put('cs', 'Cs GOVERNING', '', 'max(min(12.8-2, upper), minimum)',
        lambda d, c: f'=MAX(MIN({ref("cs_s",c)},{ref("cs_u",c)}),{ref("cs_min",c)})')
    put('gov', 'Governing check', '', '',
        lambda d, c: (f'=IF({ref("cs_min",c)}>MIN({ref("cs_s",c)},{ref("cs_u",c)}),"Minimum Cs",'
                      f'IF({ref("cs_u",c)}<{ref("cs_s",c)},"Period upper limit","SDS/(R/Ie)"))'), '@')
    def cs_upper_sys(d, c):
        rie = f'({ref("Ru",c)}/{IE})'; T = ref('T', c); s = ref('SDSu', c)
        return (f'=IF({comb(c)}="vertical",MAX(MIN({s}/{rie},IF({T}<={TL},{SD1}/({T}*{rie}),{SD1}*{TL}/({T}^2*{rie}))),'
                f'MAX(0.044*{s}*{IE},0.01),IF({S1}>=0.6,0.5*{S1}/{rie},0)),"")')
    put('cs_up', 'Cs for upper system (vertical only)', '', 'Same equations with R upper', cs_upper_sys)
    put('Vk', 'Base shear V = Cs W', 'kips', 'Section 12.8.1', lambda d, c: f'=IF({W}="","",{ref("cs",c)}*{W})', '#,##0.0')
    put('Vl', 'Base shear V', 'lbs', 'kips x 1000', lambda d, c: f'=IF({W}="","",{ref("Vk",c)}*1000)', '#,##0')
    for name in ('cs', 'Vk', 'Vl'):
        r = labels[name]; calc.cell(r, 1).font = Font(bold=True, color=NAVY)
        for col in 'BC': calc[f'{col}{r}'].fill = RESULT_FILL; calc[f'{col}{r}'].font = Font(bold=True, color=NAVY, size=12)
    calc.freeze_panes = 'B5'

    # numeric caches from the Python result
    tab = ct.table_12_2_1()
    for d in inp.directions:
        c = COLS[d.direction]; rd = res['directions'][d.direction]
        for k, sid in enumerate(d.system_ids, 1):
            s = tab[sid]
            cache.update({ref(f'R{k}', c): s['R'], ref(f'Om{k}', c): s['omega0'], ref(f'Cd{k}', c): s['Cd']})
            lim = s['height_limits_ft'].get(res['sdc']) if res['sdc'] != 'A' else None
            if isinstance(lim, float): cache[ref(f'lim{k}', c)] = lim
        vals = {'R': rd['R'], 'Om': rd['omega0'], 'Cd': rd['Cd'], 'Ct': rd['Ct'], 'x': rd['x'], 'Ta': rd['Ta'],
                'CuTa': rd['CuTa'], 'T': rd['T_used'], 'SDSu': rd['sds_used'], 'RIe': rd['r_over_ie'],
                'cs_s': rd['cs_short'], 'cs_u': rd['cs_upper'], 'cs_m1': rd['cs_min_044'], 'cs_m2': rd['cs_min_high_s1'],
                'cs_min': rd['cs_min'], 'cs': rd['cs']}
        if rd['upper_system']:
            vals.update({'Ru': rd['upper_system']['R'], 'amp': rd['transfer_amplification'], 'cs_up': rd['cs_upper_system']})
        if rd['base_shear_kips'] is not None: vals.update({'Vk': rd['base_shear_kips'], 'Vl': rd['base_shear_lbs']})
        for name, v in vals.items(): cache[ref(name, c)] = v

    # ---------------- Review notes ----------------
    notes.column_dimensions['A'].width = 130
    notes['A4'] = 'RESULT STATUS'; notes['A4'].font = Font(color=NAVY, bold=True)
    notes['A5'] = ('SYNTHETIC DEMO - NOT FOR DESIGN' if inp.source_status == 'SYNTHETIC_DEMO'
                   else 'UNVERIFIED INPUTS - ENGINEER REVIEW REQUIRED' if not inp.engineer_reviewed
                   else 'ENGINEER CONFIRMATION ENTERED - INDEPENDENT QA STILL REQUIRED')
    notes['A5'].font = Font(color=ORANGE, bold=True)
    r = 7
    for head, items in (('NOTES', res['notes']), ('WARNINGS (generated at export - not updated by Excel edits)', res['warnings'])):
        notes.cell(r, 1, head).font = Font(bold=True, color=NAVY); r += 1
        for m in items: notes.cell(r, 1, _safe_text(m)).alignment = Alignment(wrap_text=True); r += 1
        r += 1
    for d in ('X', 'Y'):
        notes.cell(r, 1, f"{d}: {res['directions'][d]['combination_rule']} | Period: {res['directions'][d]['T_basis']} | "
                         f"12.8.1.3: {res['directions'][d]['sds_cap_status']}").alignment = Alignment(wrap_text=True); r += 1

    out = BytesIO(); wb.save(out)
    return _cache_numeric_formulas(out.getvalue(), {'xl/worksheets/sheet1.xml': input_cache,
                                                    'xl/worksheets/sheet2.xml': cache})
