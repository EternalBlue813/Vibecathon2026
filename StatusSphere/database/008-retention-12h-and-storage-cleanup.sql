-- Migration: Replace 1-day retention with 12-hour retention and add storage cleanup.
-- Safe to run on existing Supabase projects.

DO $$
DECLARE
    j RECORD;
BEGIN
    FOR j IN
        SELECT jobid
        FROM cron.job
        WHERE jobname IN (
            'cleanup-news-1days',
            'cleanup-snapshots-1days',
            'cleanup-news-12hours',
            'cleanup-snapshots-12hours',
            'cleanup-storage-screenshots-12hours'
        )
    LOOP
        PERFORM cron.unschedule(j.jobid);
    END LOOP;
END $$;

SELECT cron.schedule(
    'cleanup-news-12hours',
    '0 * * * *',
    $$DELETE FROM news_articles WHERE fetched_at < NOW() - INTERVAL '12 hours'$$
);

SELECT cron.schedule(
    'cleanup-snapshots-12hours',
    '5 * * * *',
    $$DELETE FROM snapshots WHERE polled_at < NOW() - INTERVAL '12 hours'$$
);

SELECT cron.schedule(
    'cleanup-storage-screenshots-12hours',
    '10 * * * *',
    $$DELETE FROM storage.objects
      WHERE bucket_id = 'entity-image-snapshot'
        AND created_at < NOW() - INTERVAL '12 hours'$$
);
