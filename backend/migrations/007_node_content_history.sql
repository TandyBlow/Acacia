-- Content history: every content update stores the previous version so
-- accidental truncation or corruption (see the editor roundtrip incident)
-- can be rolled back per node.

CREATE TABLE node_content_history (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'save',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_node_content_history_node
    ON node_content_history(node_id, pinned, created_at);
