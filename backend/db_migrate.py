import os
import sqlite3
from datetime import datetime, timezone


def run_migrations(conn: sqlite3.Connection, migrations_dir: str = "migrations"):
    """Apply unapplied migrations in order. Baseline at version 1.

    Must be called within an existing transaction (conn is already inside
    get_db_ctx()). Does NOT begin its own transaction.
    """

    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    """)

    current = conn.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version"
    ).fetchone()[0]

    if current == 0:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT IN ('schema_version', 'sqlite_sequence')"
        ).fetchall()
        if tables:
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (1, datetime.now(timezone.utc).isoformat()),
            )
            current = 1

    if not os.path.isdir(migrations_dir):
        return

    migration_files = sorted(
        [f for f in os.listdir(migrations_dir) if f.endswith(".sql")],
        key=lambda f: int(f.split("_")[0]),
    )

    for filename in migration_files:
        version = int(filename.split("_")[0])
        if version <= current:
            continue

        filepath = os.path.join(migrations_dir, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            sql = f.read()

        conn.executescript(sql)
        conn.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
            (version, datetime.now(timezone.utc).isoformat()),
        )
        current = version
