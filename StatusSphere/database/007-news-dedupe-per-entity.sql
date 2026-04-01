-- Migration: Enforce per-entity news dedupe.
-- Safe to run on existing Supabase projects.

ALTER TABLE news_articles
ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

UPDATE news_articles
SET dedupe_key = lower(coalesce(provider, '')) || '|' || lower(coalesce(title, '')) || '|' || lower(coalesce(link, ''))
WHERE dedupe_key IS NULL;

ALTER TABLE news_articles
ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_news_articles_dedupe_key
ON news_articles (dedupe_key);
