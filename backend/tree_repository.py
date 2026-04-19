"""
Data access layer for tree visualization.
"""
from typing import List, Dict

from db import supabase


def fetch_user_tree(user_id: str) -> List[Dict]:
    """
    Fetch complete tree data for a user from Supabase.

    Returns list of nodes with: id, name, depth, parent_id, child_count, mastery_score
    """
    # Fetch all nodes for user
    nodes_response = supabase.table("nodes").select(
        "id, name, content"
    ).eq("owner_id", user_id).eq("is_deleted", False).execute()

    nodes = nodes_response.data
    if not nodes:
        return []

    node_ids = [n["id"] for n in nodes]

    # Fetch all edges (both parent and child relationships)
    edges_response = supabase.table("edges").select(
        "parent_id, child_id, sort_order"
    ).or_(f"parent_id.in.({','.join(node_ids)}),child_id.in.({','.join(node_ids)})").execute()

    edges = edges_response.data

    # Build parent and child maps
    parent_map = {}  # child_id -> parent_id
    child_count_map = {}  # parent_id -> count

    for edge in edges:
        parent_id = edge["parent_id"]
        child_id = edge["child_id"]

        if child_id in node_ids:
            parent_map[child_id] = parent_id

        if parent_id and parent_id in node_ids:
            child_count_map[parent_id] = child_count_map.get(parent_id, 0) + 1

    # Calculate depth for each node recursively
    def calculate_depth(node_id: str, visited: set) -> int:
        if node_id in visited:
            return 0  # Cycle detection
        if node_id not in parent_map:
            return 0  # Root node

        visited.add(node_id)
        parent_id = parent_map[node_id]
        if parent_id not in node_ids:
            return 0  # Parent outside user's tree

        return 1 + calculate_depth(parent_id, visited)

    # Construct tree data
    tree_data = []
    for node in nodes:
        node_id = node["id"]
        depth = calculate_depth(node_id, set())

        tree_data.append({
            "id": node_id,
            "name": node["name"],
            "depth": depth,
            "parent_id": parent_map.get(node_id),
            "child_count": child_count_map.get(node_id, 0),
            "mastery_score": 0.5  # Placeholder
        })

    # --- Debug logging ---
    print(f"[fetch_user_tree] user_id={user_id}, nodes_fetched={len(nodes)}, edges_fetched={len(edges)}")
    for n in tree_data:
        print(f"  node id={n['id'][:8]}... name={n['name']!r} depth={n['depth']} parent_id={str(n['parent_id'])[:8] if n['parent_id'] else None}... child_count={n['child_count']}")

    return tree_data
