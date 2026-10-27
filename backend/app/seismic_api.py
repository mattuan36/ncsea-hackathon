"""ASCE 7-22 Cs routes on the site API.

The published app calls these at ``/api/seismic``. They use the same calculation
as ``code/part3_seismic_base_shear`` (port 8003). Local Vite still proxies that
prefix to port 8003; this router is what the public API serves.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

PART3 = Path(__file__).resolve().parents[2] / "code" / "part3_seismic_base_shear"
if str(PART3) not in sys.path:
    sys.path.insert(0, str(PART3))

from calculation import SeismicInput, calculate  # noqa: E402
from exchange import read_exchange  # noqa: E402
from workbook import build_calculation_xlsx  # noqa: E402
import code_tables as ct  # noqa: E402

router = APIRouter(prefix="/api/seismic")


class ExportRequest(BaseModel):
    inputs: SeismicInput
    exchange_rows: list[list] = Field(default_factory=list, max_length=100)


@router.get("/systems")
def systems():
    return {
        "meta": ct.table_12_2_1_meta(),
        "systems": [
            {
                "id": s["id"],
                "category": s["category"],
                "name": s["name"],
                "R": s["R"],
                "omega0": s["omega0"],
                "Cd": s["Cd"],
                "default_period_type": ct.DEFAULT_PERIOD_TYPE.get(s["id"], "all_other"),
            }
            for s in ct.table_12_2_1().values()
        ],
        "period_types": {k: v["label"] for k, v in ct.PERIOD_TYPES.items()},
    }


@router.post("/import")
async def import_exchange(xlsx: UploadFile = File(...)):
    raw = await xlsx.read(6_000_001)
    try:
        return read_exchange(raw)
    except ValueError as err:
        raise HTTPException(422, str(err)) from None


@router.post("/calculate")
def result(inp: SeismicInput):
    return calculate(inp)


@router.post("/export")
def export(req: ExportRequest):
    calculated = calculate(req.inputs)
    blob = build_calculation_xlsx(req.inputs, req.exchange_rows)
    stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in req.inputs.project_number)[:60] or "PROJECT"
    return {
        "results": calculated,
        "filename": stem + "_Seismic_Cs_Base_Shear.xlsx",
        "xlsx_base64": base64.b64encode(blob).decode("ascii"),
    }
