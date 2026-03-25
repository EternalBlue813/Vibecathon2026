-- Enable pg_cron extension (required for scheduled cleanup)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant necessary permissions for cron jobs
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL ON SCHEMA cron TO postgres;

-- 1. SNAPSHOTS - One row per provider per poll
CREATE TABLE snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('aws', 'azure', 'gcp', 'cloudflare', 'akamai', 'fastly')),
    polled_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    health_score FLOAT NOT NULL CHECK (health_score >= 0 AND health_score <= 1),
    status TEXT NOT NULL CHECK (status IN ('Healthy', 'Warning', 'Unknown'))
);

CREATE INDEX idx_snapshots_provider_time ON snapshots (provider, polled_at DESC);

-- 2. INCIDENTS - Outages linked to snapshots
CREATE TABLE incidents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    link TEXT,
    region TEXT CHECK (region IN ('NA', 'SA', 'EU', 'AF', 'AS', 'OC', NULL)),
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_incidents_provider_time ON incidents (provider, detected_at DESC);
CREATE INDEX idx_incidents_region ON incidents (region);
CREATE INDEX idx_incidents_snapshot ON incidents (snapshot_id);

-- 3. NEWS_ARTICLES - Related news linked to snapshots
CREATE TABLE news_articles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    source TEXT,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_provider_time ON news_articles (provider, fetched_at DESC);
CREATE INDEX idx_news_snapshot ON news_articles (snapshot_id);

-- 4. AUTO CLEANUP - Delete data older than 30 days (runs daily at 3am)
SELECT cron.schedule(
    'cleanup-news-30days',
    '0 3 * * *',
    $$DELETE FROM news_articles WHERE fetched_at < NOW() - INTERVAL '30 days'$$
);

SELECT cron.schedule(
    'cleanup-snapshots-30days',
    '5 3 * * *',
    $$DELETE FROM snapshots WHERE polled_at < NOW() - INTERVAL '30 days'$$
);
