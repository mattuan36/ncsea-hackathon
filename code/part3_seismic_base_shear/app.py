"""Independent Part 3 app: read Part 1 XLSX or Revit CSV, compute ASCE 7-22 ELF Cs per direction, export formulas."""
from pathlib import Path
import base64
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from calculation import SeismicInput, calculate
from exchange import read_exchange
from workbook import build_calculation_xlsx
import code_tables as ct

ROOT = Path(__file__).resolve().parent
DEFAULT_HAZARD = ROOT / 'samples' / 'Riverside_Office_Building_Hazard_Studio_Revit_Import.csv'
app = FastAPI(title='BP Hazard Studio / Part 3', version='2.0.0')


class ExportRequest(BaseModel):
    inputs: SeismicInput
    exchange_rows: list[list] = Field(default_factory=list, max_length=100)


@app.get('/')
def home(): return FileResponse(ROOT / 'static' / 'index.html', media_type='text/html')


@app.get('/api/health')
def health(): return {'ok': True, 'standard': 'ASCE 7-22 only', 'calculation': 'ELF Cs per direction, prelim only',
                      'weight': 'engineer input only'}


@app.get('/api/systems')
def systems():
    return {'meta': ct.table_12_2_1_meta(),
            'systems': [{'id': s['id'], 'category': s['category'], 'name': s['name'], 'R': s['R'],
                         'omega0': s['omega0'], 'Cd': s['Cd'],
                         'default_period_type': ct.DEFAULT_PERIOD_TYPE.get(s['id'], 'all_other')}
                        for s in ct.table_12_2_1().values()],
            'period_types': {k: v['label'] for k, v in ct.PERIOD_TYPES.items()}}


@app.get('/api/default-hazard')
def default_hazard():
    try: return read_exchange(DEFAULT_HAZARD.read_bytes())
    except ValueError as err: raise HTTPException(422, str(err)) from None


@app.post('/api/import')
async def import_xlsx(xlsx: UploadFile = File(...)):
    raw = await xlsx.read(6_000_001)
    try: return read_exchange(raw)
    except ValueError as err: raise HTTPException(422, str(err)) from None


@app.post('/api/calculate')
def result(inp: SeismicInput): return calculate(inp)


@app.post('/api/export')
def export(req: ExportRequest):
    result = calculate(req.inputs)
    blob = build_calculation_xlsx(req.inputs, req.exchange_rows)
    stem = ''.join(c if c.isalnum() or c in '-_' else '_' for c in req.inputs.project_number)[:60] or 'PROJECT'
    return {'results': result, 'filename': stem + '_Seismic_Cs_Base_Shear.xlsx',
            'xlsx_base64': base64.b64encode(blob).decode('ascii')}
