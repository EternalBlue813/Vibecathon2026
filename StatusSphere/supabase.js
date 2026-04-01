const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials not found. Data will not be persisted.');
}

const supabase = supabaseUrl && supabaseKey 
    ? createClient(supabaseUrl, supabaseKey)
    : null;

const SNAPSHOT_STATUS_MAP = {
    Healthy: 'Healthy',
    Warning: 'Warning',
    Unknown: 'Unknown',
    Down: 'Down',
    Maintenance: 'Maintenance',
    Partial: 'Partial',
};

function normalizeSnapshotStatus(status) {
    if (typeof status !== 'string') return 'Unknown';
    const trimmed = status.trim();
    return SNAPSHOT_STATUS_MAP[trimmed] || 'Unknown';
}

async function storeSnapshot(provider, healthScore, status) {
    if (!supabase) return null;

    const dbStatus = normalizeSnapshotStatus(status);
    if (dbStatus !== status) {
        console.log(`[Supabase] Normalized snapshot status for ${provider}: "${status}" -> "${dbStatus}"`);
    }

    const { data, error } = await supabase
        .from('snapshots')
        .insert({
            provider,
            health_score: healthScore,
            status: dbStatus,
            polled_at: new Date().toISOString()
        })
        .select('id')
        .single();

    if (error) {
        console.error(`[Supabase] Failed to store snapshot for ${provider}:`, error.message);
        return null;
    }

    return data?.id || null;
}

async function storeIncident(snapshotId, provider, name, link, region) {
    if (!supabase || !snapshotId) return;

    const { error } = await supabase
        .from('incidents')
        .insert({
            snapshot_id: snapshotId,
            provider,
            name,
            link,
            region
        });

    if (error) {
        console.error(`[Supabase] Failed to store incident for ${provider}:`, error.message);
    }
}

async function storeNews(snapshotId, provider, title, link, source, publishedAt) {
    if (!supabase || !snapshotId) return;

    const duplicateWindowStart = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
    const existingQuery = supabase
        .from('news_articles')
        .select('id')
        .eq('provider', provider)
        .eq('title', title)
        .gte('fetched_at', duplicateWindowStart)
        .limit(1);

    if (link) {
        existingQuery.eq('link', link);
    } else {
        existingQuery.is('link', null);
    }

    const { data: existingRows, error: lookupError } = await existingQuery;
    if (!lookupError && Array.isArray(existingRows) && existingRows.length > 0) {
        return;
    }

    const { error } = await supabase
        .from('news_articles')
        .insert({
            snapshot_id: snapshotId,
            provider,
            title,
            link,
            source,
            published_at: publishedAt,
            fetched_at: new Date().toISOString()
        });

    if (error) {
        console.error(`[Supabase] Failed to store news for ${provider}:`, error.message);
    }
}

async function verifySupabaseConnection() {
    if (!supabase) {
        return { ok: false, reason: 'missing_credentials' };
    }

    const { error } = await supabase
        .from('snapshots')
        .select('id')
        .limit(1);

    if (error) {
        return { ok: false, reason: error.message };
    }

    return { ok: true };
}

module.exports = {
    supabase,
    storeSnapshot,
    storeIncident,
    storeNews,
    verifySupabaseConnection
};
