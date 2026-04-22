"""
AI quiz question generation service — SQLite variant.
"""
import json
import re
from uuid import uuid4

import httpx
import sqlite3

from quiz_service import call_llm_for_quiz, parse_quiz_json, SILICONFLOW_API_KEY, SILICONFLOW_MODEL, SILICONFLOW_URL


def generate_quiz_question_sqlite(node_id: str, owner_id: str, conn: sqlite3.Connection) -> dict:
    """Generate a quiz question for a specific node (SQLite path)."""
    row = conn.execute(
        "SELECT name, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    name = row["name"]
    content = row["content"] or ""

    user_input = f"知识点名称：{name}\n内容：{content}"
    raw = call_llm_for_quiz(user_input)
    quiz = parse_quiz_json(raw)
    quiz["node_id"] = node_id
    return quiz


def submit_quiz_answer_sqlite(node_id: str, owner_id: str, is_correct: bool, conn: sqlite3.Connection) -> dict:
    """Record a quiz answer and update mastery_score (SQLite path)."""
    record_id = str(uuid4())
    conn.execute(
        "INSERT INTO quiz_records (id, node_id, owner_id, is_correct) VALUES (?, ?, ?, ?)",
        (record_id, node_id, owner_id, 1 if is_correct else 0),
    )

    rows = conn.execute(
        "SELECT is_correct FROM quiz_records WHERE node_id = ? AND owner_id = ? ORDER BY answered_at DESC LIMIT 10",
        (node_id, owner_id),
    ).fetchall()

    if len(rows) > 0:
        correct_count = sum(1 for r in rows if r["is_correct"])
        mastery = correct_count / len(rows)
    else:
        mastery = 0.0

    conn.execute(
        "UPDATE nodes SET mastery_score = ? WHERE id = ?",
        (mastery, node_id),
    )

    return {"mastery_score": mastery, "total_records": len(rows)}
