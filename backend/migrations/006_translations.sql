-- Migration 006: Add English translation columns to official_nodes
-- Enables storing LLM-generated English translations of node content,
-- so the frontend can serve locale-appropriate versions.

ALTER TABLE official_nodes ADD COLUMN title_en TEXT NOT NULL DEFAULT '';
ALTER TABLE official_nodes ADD COLUMN content_en TEXT NOT NULL DEFAULT '';
