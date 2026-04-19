"""
Data access layer for tree visualization using SQLite.
"""
from database import get_db_ctx


def fetch_user_tree_sqlite(owner_id: str) -> list[dict]:
    with get_db_ctx() as conn:
        nodes = conn.execute(
            "SELECT id, name, content, parent_id FROM nodes WHERE owner_id = ? AND is_deleted = 0",
            (owner_id,),
        ).fetchall()

    if not nodes:
        return []

    node_ids = {n["id"] for n in nodes}
    child_count: dict[str, int] = {}

    for n in nodes:
        if n["parent_id"] and n["parent_id"] in node_ids:
            child_count[n["parent_id"]] = child_count.get(n["parent_id"], 0) + 1

    # Calculate depth
    depth_cache: dict[str, int] = {}

    def calc_depth(nid: str, visited: set) -> int:
        if nid in depth_cache:
            return depth_cache[nid]
        if nid in visited:
            return 0
        visited.add(nid)

        node = next((n for n in nodes if n["id"] == nid), None)
        if not node or not node["parent_id"] or node["parent_id"] not in node_ids:
            depth_cache[nid] = 0
            return 0
        d = 1 + calc_depth(node["parent_id"], visited)
        depth_cache[nid] = d
        return d

    tree_data = []
    for node in nodes:
        tree_data.append({
            "id": node["id"],
            "name": node["name"],
            "depth": calc_depth(node["id"], set()),
            "parent_id": node["parent_id"],
            "child_count": child_count.get(node["id"], 0),
            "mastery_score": 0.5,
        })

    return tree_data
