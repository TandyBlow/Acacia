"""
Domain tag service using SQLite.
"""
from collections import Counter

from database import get_db_ctx
from tag_service import tag_node


def tag_all_nodes_sqlite(owner_id: str) -> dict:
    with get_db_ctx() as conn:
        nodes = conn.execute(
            "SELECT id, name, content FROM nodes WHERE owner_id = ? AND is_deleted = 0",
            (owner_id,),
        ).fetchall()

    if not nodes:
        return {"tagged": 0, "tags": {}}

    tag_counts: Counter = Counter()
    for node in nodes:
        content_md = node["content"] or ""
        tag = tag_node(node["name"], content_md)
        tag_counts[tag] += 1

        with get_db_ctx() as conn2:
            conn2.execute("UPDATE nodes SET domain_tag = ? WHERE id = ?", (tag, node["id"]))

    return {"tagged": len(nodes), "tags": dict(tag_counts)}
