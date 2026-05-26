-- Migration 004: Official knowledge points management
-- Adds a table for admin-managed official content nodes,
-- separate from user-owned nodes (no owner_id, no FSRS fields).

CREATE TABLE IF NOT EXISTS official_nodes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    sort_order REAL NOT NULL DEFAULT 0,
    is_published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_official_nodes_sort
    ON official_nodes(sort_order, is_published);
