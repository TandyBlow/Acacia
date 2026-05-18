"""
Data access layer for tree visualization using SQLite.
"""
from database import get_db_ctx


def fetch_user_tree_sqlite(owner_id: str) -> list[dict]:
    with get_db_ctx() as conn:
        nodes = conn.execute(
            "SELECT id, name, content, parent_id, mastery_score, stability, difficulty, review_count, review_state, depth, domain_tag FROM nodes WHERE owner_id = ? AND is_deleted = 0",
            (owner_id,),
        ).fetchall()

    if not nodes:
        return []

    node_ids = {n["id"] for n in nodes}
    child_count: dict[str, int] = {}

    for n in nodes:
        if n["parent_id"] and n["parent_id"] in node_ids:
            child_count[n["parent_id"]] = child_count.get(n["parent_id"], 0) + 1

    tree_data = []
    for node in nodes:
        tree_data.append({
            "id": node["id"],
            "name": node["name"],
            "depth": node["depth"] or 0,
            "parent_id": node["parent_id"],
            "child_count": child_count.get(node["id"], 0),
            "mastery_score": node["mastery_score"] or 0.0,
            "stability": node["stability"] or 0.0,
            "difficulty": node["difficulty"] or 0.3,
            "review_count": node["review_count"] or 0,
            "review_state": node["review_state"] or "new",
            "domain_tag": node["domain_tag"] or "",
        })

    return tree_data


def fetch_user_nodes_with_knowledge(owner_id: str) -> list[dict]:
    """Fetch all user nodes with full knowledge profile data.

    Returns a flat list with mastery, FSRS data, domain tags, and tree position.
    Single query, no N+1, no recursive computation.
    """
    with get_db_ctx() as conn:
        rows = conn.execute(
            """SELECT id, name, content, parent_id, depth, domain_tag,
                      mastery_score, stability, difficulty, review_count, review_state
               FROM nodes
               WHERE owner_id = ? AND is_deleted = 0
               ORDER BY depth ASC, name ASC""",
            (owner_id,),
        ).fetchall()

    if not rows:
        return []

    return [
        {
            "id": r["id"],
            "name": r["name"],
            "parent_id": r["parent_id"],
            "depth": r["depth"] or 0,
            "domain_tag": r["domain_tag"] or "",
            "mastery_score": float(r["mastery_score"] or 0),
            "stability": float(r["stability"] or 0),
            "difficulty": float(r["difficulty"] or 0.3),
            "review_count": int(r["review_count"] or 0),
            "review_state": r["review_state"] or "new",
        }
        for r in rows
    ]
