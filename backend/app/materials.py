"""Dead load materials: Kim's spreadsheet in Postgres, behind the Materials DB page.

The spreadsheet lives outside git (INPUTS_DIR). Its rows keep the spreadsheet's
own ids ("R40" = sheet row 40), so a re-import updates them in place; rows a
user edited or added are left alone.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
INPUTS_DIR = Path(os.environ.get("LTL_INPUTS_DIR", REPO_ROOT.parent / "inputs"))

sys.path.insert(0, str(REPO_ROOT / "gravity_ifc"))
from dl_db import SUPPLEMENTAL, DbRow, load_db  # noqa: E402

COLUMNS = "id, t_in, material, orientation, use, info, psf, psf_per_in, psf_text, source, custom, edited, position"
SUPPLEMENTAL_IDS = {r.id for r in SUPPLEMENTAL}

router = APIRouter(prefix="/api/materials")


def spreadsheet_path() -> Path | None:
    """DEAD_LOAD_XLSX, else the newest Dead_Load*.xlsx in INPUTS_DIR (Excel's ~$ lock files skipped)."""
    if os.environ.get("DEAD_LOAD_XLSX"):
        return Path(os.environ["DEAD_LOAD_XLSX"])
    found = [p for p in INPUTS_DIR.glob("Dead_Load*.xlsx") if not p.name.startswith("~$")]
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


def import_rows(rows: list[DbRow]) -> int:
    """Upsert spreadsheet + proposed rows; rows the user edited keep their values."""
    with db.pool.connection() as conn:
        for position, r in enumerate(rows + SUPPLEMENTAL):
            conn.execute(
                f"""
                INSERT INTO materials ({COLUMNS})
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, false, %s)
                ON CONFLICT (id) DO UPDATE SET
                    t_in = EXCLUDED.t_in, material = EXCLUDED.material, orientation = EXCLUDED.orientation,
                    use = EXCLUDED.use, info = EXCLUDED.info, psf = EXCLUDED.psf,
                    psf_per_in = EXCLUDED.psf_per_in, psf_text = EXCLUDED.psf_text,
                    source = EXCLUDED.source, position = EXCLUDED.position, updated_at = now()
                 WHERE NOT materials.edited AND NOT materials.custom
                """,
                (r.id, r.t_in, r.material, r.orientation, r.use, r.info, r.psf, r.psf_per_in,
                 r.psf_text, r.source, position),
            )
    return len(rows) + len(SUPPLEMENTAL)


def import_if_empty() -> None:
    with db.pool.connection() as conn:
        n = conn.execute("SELECT count(*) AS n FROM materials WHERE NOT custom").fetchone()["n"]
    path = spreadsheet_path()
    if n == 0 and path is not None and path.is_file():
        import_rows(load_db(path))


def list_rows() -> list[dict]:
    with db.pool.connection() as conn:
        return conn.execute(f"SELECT {COLUMNS} FROM materials ORDER BY custom, position, id").fetchall()


def matcher_rows() -> list[DbRow]:
    """Rows for gravity_ifc's Matcher. It appends SUPPLEMENTAL itself, so those are left out here."""
    return [
        DbRow(r["id"], r["t_in"], r["material"], r["use"], r["info"], r["psf"], r["psf_per_in"],
              r["psf_text"], r["source"], r["orientation"])
        for r in list_rows()
        if r["id"] not in SUPPLEMENTAL_IDS
    ]


class MaterialIn(BaseModel):
    material: str
    t_in: float | None = None
    orientation: str = ""
    use: str = ""
    info: str = ""
    psf: float | None = None
    psf_per_in: float | None = None
    source: str = "User"


class MaterialPatch(BaseModel):
    material: str | None = None
    t_in: float | None = None
    orientation: str | None = None
    use: str | None = None
    info: str | None = None
    psf: float | None = None
    psf_per_in: float | None = None
    source: str | None = None


@router.get("")
def get_materials():
    return list_rows()


@router.post("", status_code=201)
def add_material(m: MaterialIn):
    if not m.material.strip():
        raise HTTPException(400, "Material name is required")
    psf = m.psf if m.psf is not None or m.psf_per_in is None or not m.t_in else round(m.psf_per_in * m.t_in, 2)
    with db.pool.connection() as conn:
        return conn.execute(
            f"""
            INSERT INTO materials ({COLUMNS})
            VALUES ('U' || nextval('materials_custom_seq'), %s, %s, %s, %s, %s, %s, %s, NULL, %s, true, false,
                    (SELECT COALESCE(max(position), 0) + 1 FROM materials))
            RETURNING {COLUMNS}
            """,
            (m.t_in, m.material.strip(), m.orientation, m.use, m.info, psf, m.psf_per_in, m.source),
        ).fetchone()


@router.patch("/{material_id}")
def patch_material(material_id: str, patch: MaterialPatch):
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "Nothing to change")
    sets = ", ".join(f"{k} = %s" for k in fields)
    with db.pool.connection() as conn:
        row = conn.execute(
            f"UPDATE materials SET {sets}, edited = true, updated_at = now() WHERE id = %s RETURNING {COLUMNS}",
            (*fields.values(), material_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Material not found")
    return row


@router.delete("/{material_id}", status_code=204)
def delete_material(material_id: str):
    with db.pool.connection() as conn:
        deleted = conn.execute("DELETE FROM materials WHERE id = %s", (material_id,)).rowcount
    if not deleted:
        raise HTTPException(404, "Material not found")
    return Response(status_code=204)


@router.post("/import")
def reimport():
    """Re-read the spreadsheet. Imported rows update; edited and user-added rows are kept."""
    path = spreadsheet_path()
    if path is None or not path.is_file():
        raise HTTPException(404, f"No Dead_Load*.xlsx in {INPUTS_DIR}")
    return {"file": path.name, "rows": import_rows(load_db(path))}
