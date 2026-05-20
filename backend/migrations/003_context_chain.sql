-- Migration 003: Learning Context Chain tables
-- Tracks cross-node navigation and learning summaries for
-- context-aware adaptive AI tutoring.

CREATE TABLE IF NOT EXISTS context_transitions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    from_node_id TEXT,
    to_node_id TEXT NOT NULL,
    transition_type TEXT NOT NULL DEFAULT 'navigation',
    reason TEXT NOT NULL DEFAULT '',
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_context_transitions_owner
    ON context_transitions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_transitions_from_to
    ON context_transitions(from_node_id, to_node_id);
CREATE INDEX IF NOT EXISTS idx_context_transitions_to
    ON context_transitions(to_node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS node_learning_snapshots (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    node_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    learned_concepts TEXT NOT NULL DEFAULT '',
    mastery_changes TEXT NOT NULL DEFAULT '[]',
    created_nodes TEXT NOT NULL DEFAULT '[]',
    knowledge_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learning_snapshots_node
    ON node_learning_snapshots(node_id, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_snapshots_owner
    ON node_learning_snapshots(owner_id, created_at DESC);
