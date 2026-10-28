"""Background worker: `python -m app.extract_job <model id>` (started by models_api).

Runs gravity_ifc's extract() on the stored IFC, matching layers against the
materials table, and writes stage / progress / result / error into `models`.
Progress comes from the extractor's own log lines.
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
import traceback

import psycopg
from psycopg.types.json import Jsonb

from . import db
from .materials import matcher_rows  # also puts gravity_ifc on sys.path

# extractor log line -> (stage, progress at that point)
_MESHED = re.compile(r"meshed (\d+)/(\d+)")


def _clean(o):
    """JSON-safe copy: NaN/inf (numpy maths on odd geometry) become null; numpy scalars become floats."""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, float) or type(o).__module__ == "numpy":
        try:
            f = float(o)
        except (TypeError, ValueError):
            return o
        return None if math.isnan(f) or math.isinf(f) else (int(f) if type(o).__name__.startswith("int") else f)
    return o


def run(model_id: int) -> None:
    # Same prepare_threshold=None as init_db. This connection repeats one UPDATE
    # for every progress tick; the pool is what matcher_rows() uses. Either one
    # preparing a statement fails on Supabase's transaction pooler.
    conn = psycopg.connect(db.DATABASE_URL, autocommit=True, prepare_threshold=None)
    db.pool = db.make_pool(min_size=1, max_size=1)
    last = [0.0]

    def report(stage: str, progress: float, force: bool = False) -> None:
        now = time.time()
        if force or now - last[0] > 0.5:
            last[0] = now
            conn.execute(
                "UPDATE models SET status = 'running', stage = %s, progress = %s WHERE id = %s",
                (stage, round(min(progress, 0.99), 3), model_id),
            )

    row = conn.execute("SELECT storage_path FROM models WHERE id = %s", (model_id,)).fetchone()
    if row is None:
        return
    try:
        import ifc_extract

        def log(*a):
            msg = " ".join(str(x) for x in a)
            print(msg, file=sys.stderr, flush=True)
            if msg.startswith("opened"):
                report("Collecting wall, floor, roof and ceiling types", 0.15, True)
            elif m := _MESHED.search(msg):
                done, total = int(m.group(1)), int(m.group(2))
                report(f"Meshing geometry ({done:,} of {total:,} shapes)", 0.2 + 0.6 * done / max(total, 1))
            elif msg.startswith("meshed"):
                report("Building plans and assemblies", 0.82, True)
            elif "in-scope elements" in msg:
                report(f"Matching layers to the materials DB ({msg.split(',')[0]})", 0.2, True)

        ifc_extract.log = log
        report("Opening the IFC file", 0.03, True)
        data = _clean(ifc_extract.extract(row[0], None, with_geometry=True, db_rows=matcher_rows()))
        report("Saving", 0.97, True)
        conn.execute(
            """
            UPDATE models SET status = 'ready', stage = 'Ready', progress = 1, result = %s, error = NULL,
                   finished_at = now()
             WHERE id = %s
            """,
            (Jsonb(data, dumps=lambda o: json.dumps(o, allow_nan=False)), model_id),
        )
    except Exception as exc:  # report every failure to the UI, not just the log
        traceback.print_exc()
        conn.execute(
            "UPDATE models SET status = 'failed', stage = 'Failed', error = %s, finished_at = now() WHERE id = %s",
            (f"{type(exc).__name__}: {exc}", model_id),
        )
    finally:
        db.pool.close()
        conn.close()


if __name__ == "__main__":
    run(int(sys.argv[1]))
