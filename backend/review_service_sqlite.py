"""
FSRS (Free Spaced Repetition Scheduler) service — SQLite version.
Core spaced repetition algorithm replacing simple sliding-window mastery.
No external dependencies — pure Python math.
"""
import math
import sqlite3
from datetime import datetime, timezone, timedelta


def datetime_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _calculate_retrievability(stability: float, last_review_at: str | None) -> float:
    """Calculate current retrievability R(t) = exp(-t / S).
    Returns 0 for new cards (S=0 or never reviewed)."""
    if not stability or stability <= 0 or not last_review_at:
        return 0.0
    try:
        last = datetime.strptime(last_review_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        elapsed_days = (now - last).total_seconds() / 86400.0
        if elapsed_days < 0:
            elapsed_days = 0
        return math.exp(-elapsed_days / stability)
    except (ValueError, OSError):
        return 0.0


def _update_fsrs_params(conn: sqlite3.Connection, node_id: str, rating: int) -> dict:
    """Core FSRS update after a review. Reads current params, applies FSRS formulas,
    writes back updated stability/difficulty/review_count/state/next_review_at,
    and sets mastery_score to current R(t).

    rating: 1=Again, 2=Hard, 3=Good, 4=Easy
    """
    row = conn.execute(
        "SELECT stability, difficulty, review_count, review_state, last_review_at "
        "FROM nodes WHERE id = ?",
        (node_id,),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    S = float(row["stability"] or 0)
    D = float(row["difficulty"] or 0.3)
    count = int(row["review_count"] or 0)
    state = row["review_state"] or "new"

    # ── Difficulty update ──
    D = D + 0.15 * (3 - rating) * (1 - D)
    D = max(0.01, min(1.0, D))

    # ── Stability update ──
    is_first = count == 0 or S <= 0
    if is_first:
        # First review — initial stability mapping
        if rating == 1:
            S = 0.5
        elif rating == 2:
            S = 1.0
        elif rating == 3:
            S = 2.0
        else:  # rating == 4
            S = 4.0
    else:
        if rating == 1:  # Again
            S = max(0.5, S * 0.5)
        elif rating == 2:  # Hard
            S = S * 1.3
        elif rating == 3:  # Good
            S = S * 2.5
        else:  # rating == 4 (Easy)
            S = S * 4.0

    # ── State machine ──
    if state == "new":
        state = "review"
    elif rating == 1:
        state = "relearning"
    elif state == "relearning" and rating >= 3:
        state = "review"

    # ── Next review interval ──
    # Target 90% retention: interval = S * ln(1/0.9) ≈ S * 0.10536
    interval_days = S * 0.10536
    now = datetime_now()
    next_review = _add_days(now, interval_days)

    # ── Current retrievability as mastery_score ──
    mastery = _calculate_retrievability(S, now)

    conn.execute(
        """UPDATE nodes SET
           stability = ?, difficulty = ?, review_count = ?,
           review_state = ?, last_review_at = ?, next_review_at = ?,
           mastery_score = ?, updated_at = ?
           WHERE id = ?""",
        (S, D, count + 1, state, now, next_review, mastery, now, node_id),
    )

    return {
        "node_id": node_id,
        "stability": round(S, 4),
        "difficulty": round(D, 4),
        "retrievability": round(mastery, 4),
        "mastery_score": round(mastery, 4),
        "review_count": count + 1,
        "review_state": state,
        "next_review_at": next_review,
        "last_review_at": now,
    }


def _add_days(iso_str: str, days: float) -> str:
    """Add days to an ISO datetime string, return new ISO string."""
    try:
        dt = datetime.strptime(iso_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        result = dt + timedelta(seconds=days * 86400)
        return result.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, OSError):
        return iso_str


def get_due_reviews_sqlite(owner_id: str, conn: sqlite3.Connection, limit: int = 20) -> list[dict]:
    """Get nodes due for review, ordered by retrievability ascending (most urgent first)."""
    now = datetime_now()
    rows = conn.execute(
        """SELECT id, name, content, stability, difficulty, review_count,
                  review_state, last_review_at, next_review_at, mastery_score
           FROM nodes
           WHERE owner_id = ? AND is_deleted = 0
           ORDER BY
             CASE WHEN stability <= 0 OR last_review_at IS NULL THEN 0 ELSE 1 END,
             mastery_score ASC
           LIMIT ?""",
        (owner_id, limit),
    ).fetchall()

    results = []
    for r in rows:
        S = float(r["stability"] or 0)
        last = r["last_review_at"] or None
        R = _calculate_retrievability(S, last)
        results.append({
            "node_id": r["id"],
            "node_name": r["name"],
            "content": r["content"] or "",
            "retrievability": round(R, 4),
            "stability": round(S, 4),
            "difficulty": round(float(r["difficulty"] or 0.3), 4),
            "review_count": int(r["review_count"] or 0),
            "review_state": r["review_state"] or "new",
            "next_review_at": r["next_review_at"] or None,
        })

    # Sort: new cards first, then by retrievability ascending
    results.sort(key=lambda x: (x["stability"] > 0, x["retrievability"]))
    return results


def submit_review_sqlite(node_id: str, owner_id: str, rating: int, conn: sqlite3.Connection) -> dict:
    """Submit a review rating and update FSRS parameters."""
    # Verify ownership
    row = conn.execute(
        "SELECT id FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not row:
        raise ValueError("Node not found")

    if rating not in (1, 2, 3, 4):
        raise ValueError("Rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)")

    return _update_fsrs_params(conn, node_id, rating)


def get_review_stats_sqlite(owner_id: str, conn: sqlite3.Connection) -> dict:
    """Get review statistics for the user."""
    now = datetime_now()
    today_prefix = now[:10]  # "2026-04-26"

    total_nodes = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND is_deleted = 0",
        (owner_id,),
    ).fetchone()[0]

    due_count = conn.execute(
        """SELECT COUNT(*) FROM nodes
           WHERE owner_id = ? AND is_deleted = 0
             AND (stability <= 0 OR last_review_at IS NULL
                  OR next_review_at <= ?)""",
        (owner_id, now),
    ).fetchone()[0]

    today_reviewed = conn.execute(
        """SELECT COUNT(*) FROM nodes
           WHERE owner_id = ? AND is_deleted = 0
             AND last_review_at LIKE ?""",
        (owner_id, f"{today_prefix}%"),
    ).fetchone()[0]

    stability_row = conn.execute(
        "SELECT COALESCE(AVG(stability), 0) FROM nodes WHERE owner_id = ? AND is_deleted = 0 AND stability > 0",
        (owner_id,),
    ).fetchone()
    avg_stability = float(stability_row[0] or 0)

    new_count = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND is_deleted = 0 AND (review_state = 'new' OR review_state IS NULL)",
        (owner_id,),
    ).fetchone()[0]

    return {
        "total_nodes": total_nodes,
        "due_count": due_count,
        "today_reviewed": today_reviewed,
        "avg_stability": round(avg_stability, 2),
        "new_count": new_count,
    }
