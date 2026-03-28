-- Migration: Allow bank entity slugs in the snapshots, incidents, and news_articles tables.
-- Run this after 001-initial.sql.

-- Drop and recreate the provider CHECK constraint on snapshots
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_provider_check;
ALTER TABLE snapshots ADD CONSTRAINT snapshots_provider_check
    CHECK (provider IN (
        'aws', 'azure', 'gcp', 'cloudflare', 'akamai', 'fastly',
        'dbs', 'ocbc', 'uob', 'citi', 'scb', 'hsbc', 'maybank', 'sxp'
    ));

-- Drop and recreate the status CHECK to include 'Down' for banks
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_status_check;
ALTER TABLE snapshots ADD CONSTRAINT snapshots_status_check
    CHECK (status IN ('Healthy', 'Warning', 'Unknown', 'Down'));
