"""
SQLite persistence layer for local deployment.
"""
import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.getenv("DB_PATH", "seewhat.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_db_ctx():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db_ctx() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                parent_id TEXT,
                sort_order REAL NOT NULL DEFAULT 0,
                domain_tag TEXT,
                mastery_score REAL NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS edges (
                parent_id TEXT NOT NULL,
                child_id TEXT NOT NULL,
                sort_order REAL NOT NULL DEFAULT 0,
                relationship_type TEXT NOT NULL DEFAULT 'parent-child',
                PRIMARY KEY (parent_id, child_id)
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_owner ON nodes(owner_id, is_deleted);
            CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
            CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_id);

            CREATE TABLE IF NOT EXISTS quiz_records (
                id TEXT PRIMARY KEY,
                node_id TEXT NOT NULL REFERENCES nodes(id),
                owner_id TEXT NOT NULL REFERENCES users(id),
                is_correct INTEGER NOT NULL,
                answered_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_quiz_records_node_owner ON quiz_records(node_id, owner_id, answered_at DESC);
        """)

        # Migration: add mastery_score column if missing
        cols = [row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()]
        if "mastery_score" not in cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN mastery_score REAL NOT NULL DEFAULT 0")
