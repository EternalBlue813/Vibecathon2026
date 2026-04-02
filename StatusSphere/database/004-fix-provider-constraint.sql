-- Migration: Remove hardcoded provider CHECK and rely on entities FK.
-- Safe to run on existing Supabase projects.

ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_provider_check;

ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS fk_snapshots_entity;
ALTER TABLE snapshots ADD CONSTRAINT fk_snapshots_entity
    FOREIGN KEY (provider) REFERENCES entities(slug) ON DELETE CASCADE;
