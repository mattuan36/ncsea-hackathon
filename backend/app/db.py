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
        "Project Documents": {"3D Models": {}, "Markups": {}, "Plans": {}, "Site Reports": {}},
        "Calculations": {},
    }
}

SITE_REPORTS_PATH = ("My Project", "Project Documents", "Site Reports")

pool: ConnectionPool | None = None


def _seed(cur, tree: dict, parent_id: int | None) -> None:
    for position, (name, children) in enumerate(tree.items()):
        cur.execute(
            "INSERT INTO folders (parent_id, name, position) VALUES (%s, %s, %s) RETURNING id",
            (parent_id, name, position),
        )
        _seed(cur, children, cur.fetchone()["id"])


def ensure_folder_path(names: tuple[str, ...] | list[str] = SITE_REPORTS_PATH) -> int:
    """Return the folder at ``names``, creating any missing segment.

    Used for the seeded tree and for already-running databases that predate
    the Site Reports folder.
    """
    parent_id = None
    folder_id = None
    with pool.connection() as conn:
        for name in names:
            row = conn.execute(
                """
                SELECT id FROM folders
                 WHERE parent_id IS NOT DISTINCT FROM %s AND name = %s
                """,
                (parent_id, name),
            ).fetchone()
            if row is None:
                row = conn.execute(
                    """
                    INSERT INTO folders (parent_id, name, position)
                    VALUES (
                        %s, %s,
                        COALESCE(
                            (SELECT max(position) + 1 FROM folders
                              WHERE parent_id IS NOT DISTINCT FROM %s),
                            0
                        )
                    )
                    RETURNING id
                    """,
                    (parent_id, name, parent_id),
                ).fetchone()
            folder_id = row["id"]
            parent_id = folder_id
    if folder_id is None:
        raise RuntimeError("Folder path was empty")
    return folder_id


def init_db() -> None:
    global pool
    pool = ConnectionPool(DATABASE_URL, kwargs={"row_factory": dict_row})
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(SCHEMA_PATH.read_text())
        cur.execute("SELECT count(*) AS n FROM folders")
        if cur.fetchone()["n"] == 0:
            _seed(cur, SEED_TREE, None)
    ensure_folder_path()
