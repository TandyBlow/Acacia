import pytest
import sqlite3
import os
import tempfile

from db_migrate import run_migrations


def test_applies_migrations_in_order(in_memory_db):
    """NF-07: Applies SQL files sorted by numeric prefix, tracking versions."""
    conn = in_memory_db

    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "001_test.sql"), "w") as f:
            f.write("CREATE TABLE test_table_1 (id INTEGER);")
        with open(os.path.join(tmpdir, "002_test.sql"), "w") as f:
            f.write("CREATE TABLE test_table_2 (id INTEGER);")

        run_migrations(conn, tmpdir)

        versions = conn.execute(
            "SELECT version, applied_at FROM schema_version ORDER BY version"
        ).fetchall()
        assert len(versions) == 2, f"Expected 2 versions, got {len(versions)}"
        assert versions[0]["version"] == 1
        assert versions[1]["version"] == 2

        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        assert "test_table_1" in tables
        assert "test_table_2" in tables


def test_baselines_existing_schema(in_memory_db):
    """NF-08: Existing tables get baselined at version 1."""
    conn = in_memory_db
    conn.execute("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO users (id, name) VALUES ('1', 'test')")

    run_migrations(conn, "nonexistent_migrations_dir")

    version = conn.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version"
    ).fetchone()[0]
    assert version == 1, f"Expected version 1 baseline, got {version}"

    row = conn.execute("SELECT id, name FROM users WHERE id='1'").fetchone()
    assert row is not None
    assert row["name"] == "test"


def test_handles_partial_migration(in_memory_db):
    """NF-09: Partially applied migration is handled idempotently."""
    conn = in_memory_db
    conn.execute(
        "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)"
    )
    conn.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-01-01T00:00:00')"
    )
    conn.execute("CREATE TABLE existing_table (id INTEGER)")
    conn.commit()

    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "002_test.sql"), "w") as f:
            f.write("CREATE TABLE IF NOT EXISTS partial_test (id INTEGER);")

        run_migrations(conn, tmpdir)

        version = conn.execute(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version"
        ).fetchone()[0]
        assert version == 2, f"Expected version 2, got {version}"

        count = conn.execute(
            "SELECT COUNT(*) FROM schema_version WHERE version=1"
        ).fetchone()[0]
        assert count == 1, "Should not duplicate version 1"

        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        assert "partial_test" in tables


def test_migration_idempotent(in_memory_db):
    """NF-09 edge case: IF NOT EXISTS makes re-application safe."""
    conn = in_memory_db
    conn.execute("CREATE TABLE already_exists (id INTEGER)")
    conn.execute("INSERT INTO already_exists (id) VALUES (42)")

    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "001_test.sql"), "w") as f:
            f.write("CREATE TABLE IF NOT EXISTS already_exists (id INTEGER);")

        run_migrations(conn, tmpdir)

        version = conn.execute(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version"
        ).fetchone()[0]
        assert version == 1

        row = conn.execute("SELECT id FROM already_exists WHERE id=42").fetchone()
        assert row is not None
