-- Migration 005: Persist user style data
-- Stores AI-generated style params, background info, and profile text
-- so styles survive server restarts without unnecessary AI regeneration.

CREATE TABLE IF NOT EXISTS user_styles (
    owner_id TEXT PRIMARY KEY,
    profile_hash TEXT NOT NULL,
    profile_text TEXT NOT NULL DEFAULT '',
    style_name TEXT NOT NULL DEFAULT 'default',
    style_description TEXT NOT NULL DEFAULT '',
    background_prompt TEXT NOT NULL DEFAULT '',
    background_url TEXT,
    params_json TEXT NOT NULL DEFAULT '{}',
    distribution_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
