import os
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://app:app@localhost:55432/structural_app"
)

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"

# Default folder layout created on first start (mirrors the reference design).
SEED_TREE = {
    "My Project": {
        "Project Documents": {"3D Models": {}, "Markups": {}, "Plans": {}},
        "Calculations": {},
    }
}

pool: ConnectionPool | None = None


def _seed(cur, tree: dict, parent_id: int | None) -> None:
    for position, (name, children) in enumerate(tree.items()):
        cur.execute(
            "INSERT INTO folders (parent_id, name, position) VALUES (%s, %s, %s) RETURNING id",
            (parent_id, name, position),
        )
        _seed(cur, children, cur.fetchone()["id"])


def init_db() -> None:
    global pool
    pool = ConnectionPool(DATABASE_URL, kwargs={"row_factory": dict_row})
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_PATH.read_text())
        cur.execute("SELECT count(*) AS n FROM folders")
        if cur.fetchone()["n"] == 0:
            _seed(cur, SEED_TREE, None)
