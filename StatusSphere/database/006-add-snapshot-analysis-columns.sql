-- Migration: Add analysis + screenshot traceability fields to snapshots.
-- Safe to run on existing Supabase projects.

ALTER TABLE snapshots
ADD COLUMN IF NOT EXISTS llm_sentiment TEXT,
ADD COLUMN IF NOT EXISTS llm_summary TEXT,
ADD COLUMN IF NOT EXISTS llm_issue_type TEXT,
ADD COLUMN IF NOT EXISTS llm_confidence FLOAT CHECK (llm_confidence >= 0 AND llm_confidence <= 1),
ADD COLUMN IF NOT EXISTS extracted_keywords JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS analysis_screenshot_url TEXT,
ADD COLUMN IF NOT EXISTS analysis_screenshot_captured_at TIMESTAMPTZ;
