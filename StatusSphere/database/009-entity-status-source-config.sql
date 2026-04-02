-- Migration: Add DB-driven status source metadata for entities.
-- Safe to run on existing Supabase projects.

ALTER TABLE entities
ADD COLUMN IF NOT EXISTS status_source_kind TEXT NOT NULL DEFAULT 'generic_status_page',
ADD COLUMN IF NOT EXISTS status_source_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_status_source_kind_check;

ALTER TABLE entities
ADD CONSTRAINT entities_status_source_kind_check
    CHECK (status_source_kind IN ('generic_status_page', 'aws_public_health'));

UPDATE entities
SET status_source_kind = 'generic_status_page'
WHERE status_source_kind IS NULL;

UPDATE entities
SET status_source_kind = 'aws_public_health',
    status_source_config = jsonb_strip_nulls(jsonb_build_object(
        'services_url', 'https://servicedata-ap-northeast-1-prod.s3.amazonaws.com/services.json',
        'history_url', 'https://history-events-ap-northeast-1-prod.s3.amazonaws.com/historyevents.json'
    ))
WHERE slug = 'aws';
