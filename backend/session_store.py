"""
Unified session persistence layer for Acacia chat.
Single canonical _load_session / _save_session for chat_service.

Reads/writes all 22 columns of conversation_sessions including context chain and document tracking fields.
"""
import json
import time
from database import get_db_ctx


def load_session(session_id: str) -> dict | None:
    """Load a conversation session by ID. Returns None if not found."""
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT * FROM conversation_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
    if not row:
        return None

    return {
        "session_id": row["id"],
        "owner_id": row["owner_id"],
        "node_id": row["node_id"],
        "file_id": row["file_id"],
        "knowledge_points": json.loads(row["knowledge_points"]),
        "current_index": row["current_index"],
        "messages": json.loads(row["messages"]),
        "generated_content": row["generated_content"],
        "status": row["status"],
        "follow_up_count": row["follow_up_count"],
        "self_correction_count": row["self_correction_count"],
        "uncertainty_count": row["uncertainty_count"],
        "pending_example": json.loads(row["pending_example"]) if row["pending_example"] else None,
        "example_history": json.loads(row["example_history"]),
        "opening_message": row["opening_message"] if "opening_message" in row.keys() else "",
        "transition_context": row["transition_context"] if "transition_context" in row.keys() else "",
        "previous_node_id": row["previous_node_id"] if "previous_node_id" in row.keys() else None,
        "transition_reason": row["transition_reason"] if "transition_reason" in row.keys() else "",
        "chat_mode": row["chat_mode"] if "chat_mode" in row.keys() else "single",
        "doc_segments": json.loads(row["doc_segments"]) if "doc_segments" in row.keys() and row["doc_segments"] else [],
        "current_position": row["current_position"] if "current_position" in row.keys() else 0,
        "created_at": row["created_at"],
        "last_activity_at": row["last_activity_at"],
    }


def save_session(session: dict):
    """Persist a conversation session to SQLite (INSERT OR REPLACE)."""
    with get_db_ctx() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO conversation_sessions
               (id, owner_id, node_id, file_id, knowledge_points, current_index,
                messages, generated_content, status, follow_up_count,
                self_correction_count, uncertainty_count, pending_example,
                example_history, opening_message, transition_context,
                previous_node_id, transition_reason, chat_mode, doc_segments,
                current_position, created_at, last_activity_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session["session_id"],
                session["owner_id"],
                session["node_id"],
                session["file_id"],
                json.dumps(session.get("knowledge_points", []), ensure_ascii=False),
                session.get("current_index", 0),
                json.dumps(session.get("messages", []), ensure_ascii=False),
                session.get("generated_content", ""),
                session.get("status", "active"),
                session.get("follow_up_count", 0),
                session.get("self_correction_count", 0),
                session.get("uncertainty_count", 0),
                json.dumps(session.get("pending_example"), ensure_ascii=False) if session.get("pending_example") else None,
                json.dumps(session.get("example_history", []), ensure_ascii=False),
                session.get("opening_message", ""),
                session.get("transition_context", ""),
                session.get("previous_node_id"),
                session.get("transition_reason", ""),
                session.get("chat_mode", "single"),
                json.dumps(session.get("doc_segments", []), ensure_ascii=False),
                session.get("current_position", 0),
                session.get("created_at", time.time()),
                session.get("last_activity_at", time.time()),
            ),
        )
