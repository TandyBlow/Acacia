"""
SQLite persistence layer for local deployment.
"""
import sqlite3
import os
from contextlib import contextmanager
from db_migrate import run_migrations

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.getenv("DB_PATH", os.path.join(_BACKEND_DIR, "acacia.db"))


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
        run_migrations(conn)

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

            CREATE TABLE IF NOT EXISTS daily_quiz_completion (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                date TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 1,
                completed_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, date)
            );

            CREATE INDEX IF NOT EXISTS idx_daily_quiz_user_date ON daily_quiz_completion(user_id, date DESC);

            CREATE TABLE IF NOT EXISTS conversation_sessions (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                file_id TEXT NOT NULL DEFAULT '',
                knowledge_points TEXT NOT NULL DEFAULT '[]',
                current_index INTEGER NOT NULL DEFAULT 0,
                messages TEXT NOT NULL DEFAULT '[]',
                generated_content TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                follow_up_count INTEGER NOT NULL DEFAULT 0,
                self_correction_count INTEGER NOT NULL DEFAULT 0,
                uncertainty_count INTEGER NOT NULL DEFAULT 0,
                pending_example TEXT,
                example_history TEXT NOT NULL DEFAULT '[]',
                opening_message TEXT NOT NULL DEFAULT '',
                transition_context TEXT NOT NULL DEFAULT '',
                previous_node_id TEXT,
                transition_reason TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT 0,
                last_activity_at REAL NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_conversation_sessions_owner ON conversation_sessions(owner_id, last_activity_at DESC);
            CREATE INDEX IF NOT EXISTS idx_conversation_sessions_node ON conversation_sessions(node_id, owner_id, status);

            CREATE TABLE IF NOT EXISTS node_chat_memories (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                compressed_summary TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0,
                compressed_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_node_chat_memories ON node_chat_memories(owner_id, node_id, compressed_at DESC);
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

        # Context chain columns for conversation_sessions
        sess_cols = [row[1] for row in conn.execute("PRAGMA table_info(conversation_sessions)").fetchall()]
        if "opening_message" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN opening_message TEXT NOT NULL DEFAULT ''")
        if "transition_context" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN transition_context TEXT NOT NULL DEFAULT ''")
        if "previous_node_id" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN previous_node_id TEXT")
        if "transition_reason" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN transition_reason TEXT NOT NULL DEFAULT ''")
        if "chat_mode" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'single'")
        if "doc_segments" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN doc_segments TEXT NOT NULL DEFAULT '[]'")
        if "current_position" not in sess_cols:
            conn.execute("ALTER TABLE conversation_sessions ADD COLUMN current_position INTEGER NOT NULL DEFAULT 0")

        # WAL mode for concurrent reads on low-memory VPS
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-2000")
        conn.execute("PRAGMA temp_store=MEMORY")
