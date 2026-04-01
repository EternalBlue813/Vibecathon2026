-- Migration: allow richer snapshot statuses from modular fetch pipeline.
-- Safe to run on existing Supabase projects.

ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_status_check;

ALTER TABLE snapshots ADD CONSTRAINT snapshots_status_check
    CHECK (status IN ('Healthy', 'Warning', 'Unknown', 'Down', 'Maintenance', 'Partial'));
