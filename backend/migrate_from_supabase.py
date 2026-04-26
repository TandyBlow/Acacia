"""
One-time migration: export data from Supabase and import into SQLite.
Run this before shutting down the Supabase project.

Usage:
  pip install supabase
  SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... python migrate_from_supabase.py
"""
import json
import os
from supabase import create_client
from database import get_db_ctx, init_db


def migrate():
    sb = create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY"),
    )

    init_db()

    # Fetch all non-deleted nodes
    nodes = sb.table("nodes").select("*").eq("is_deleted", False).execute().data
    edges = sb.table("edges").select("*").execute().data
    quiz_records = sb.table("quiz_records").select("*").execute().data

    with get_db_ctx() as conn:
        # Insert users (extract unique owner_ids — but we need usernames)
        # Users must be registered separately or via the Supabase admin API
        # For now, collect unique owner_ids
        owner_ids = set(n["owner_id"] for n in nodes)
        existing_users = {r["id"] for r in conn.execute("SELECT id FROM users").fetchall()}
        missing_users = owner_ids - existing_users

        if missing_users:
            print(f"WARNING: {len(missing_users)} users not in SQLite. They need to re-register.")
            print("Missing owner_ids:", missing_users)

        for node in nodes:
            content = node.get("content", "")
            if isinstance(content, dict):
                content = content.get("markdown", json.dumps(content))

            conn.execute(
                "INSERT OR IGNORE INTO nodes (id, owner_id, name, content, parent_id, sort_order, depth, domain_tag, mastery_score, is_deleted, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    node["id"],
                    node["owner_id"],
                    node["name"],
                    content,
                    node.get("parent_id_cache"),
                    node.get("sort_order", 0),
                    node.get("depth", 0),
                    node.get("domain_tag", "其他"),
                    node.get("mastery_score", 0),
                    1 if node.get("is_deleted") else 0,
                    node.get("created_at", ""),
                    node.get("updated_at", ""),
                ),
            )

        for edge in edges:
            conn.execute(
                "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order, relationship_type) "
                "VALUES (?, ?, ?, ?)",
                (
                    edge["parent_id"],
                    edge["child_id"],
                    edge.get("sort_order", 0),
                    edge.get("relationship_type", "parent-child"),
                ),
            )

        for record in quiz_records:
            conn.execute(
                "INSERT OR IGNORE INTO quiz_records (id, node_id, owner_id, is_correct, answered_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    record["id"],
                    record["node_id"],
                    record["owner_id"],
                    1 if record.get("is_correct") else 0,
                    record.get("answered_at", ""),
                ),
            )

    print(f"Migrated {len(nodes)} nodes, {len(edges)} edges, {len(quiz_records)} quiz records")


if __name__ == "__main__":
    migrate()
