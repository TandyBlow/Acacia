"""
SQLite persistence layer for local deployment.
"""
import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.getenv("DB_PATH", "acacia.db")


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
                depth INTEGER NOT NULL DEFAULT 0,
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

            CREATE TABLE IF NOT EXISTS quiz_questions (
                id TEXT PRIMARY KEY,
                node_id TEXT NOT NULL REFERENCES nodes(id),
                owner_id TEXT NOT NULL REFERENCES users(id),
                question TEXT NOT NULL,
                options TEXT NOT NULL,
                correct_index INTEGER NOT NULL,
                explanation TEXT NOT NULL DEFAULT '',
                question_type TEXT NOT NULL DEFAULT 'single_choice',
                difficulty TEXT NOT NULL DEFAULT 'medium',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_quiz_questions_node ON quiz_questions(node_id, owner_id);

            CREATE TABLE IF NOT EXISTS quiz_records (
                id TEXT PRIMARY KEY,
                node_id TEXT NOT NULL REFERENCES nodes(id),
                owner_id TEXT NOT NULL REFERENCES users(id),
                question_id TEXT REFERENCES quiz_questions(id),
                is_correct INTEGER NOT NULL,
                answered_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_quiz_records_node_owner ON quiz_records(node_id, owner_id, answered_at DESC);
        """)

        # Migration: add missing columns
        cols = [row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()]
        if "mastery_score" not in cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN mastery_score REAL NOT NULL DEFAULT 0")
        if "depth" not in cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN depth INTEGER NOT NULL DEFAULT 0")

        quiz_cols = [row[1] for row in conn.execute("PRAGMA table_info(quiz_records)").fetchall()]
        if "question_id" not in quiz_cols:
            conn.execute("ALTER TABLE quiz_records ADD COLUMN question_id TEXT REFERENCES quiz_questions(id)")

        # FSRS spaced repetition columns
        fsrs_cols = [row[1] for row in conn.execute("PRAGMA table_info(nodes)").fetchall()]
        if "stability" not in fsrs_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN stability REAL NOT NULL DEFAULT 0")
        if "difficulty" not in fsrs_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN difficulty REAL NOT NULL DEFAULT 0.3")
        if "last_review_at" not in fsrs_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN last_review_at TEXT")
        if "next_review_at" not in fsrs_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN next_review_at TEXT")
        if "review_count" not in fsrs_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0")
        if "review_state" not in fsrs_cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN review_state TEXT NOT NULL DEFAULT 'new'")

        # WAL mode for concurrent reads on low-memory VPS
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-2000")
        conn.execute("PRAGMA temp_store=MEMORY")
