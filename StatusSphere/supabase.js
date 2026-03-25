const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials not found. Data will not be persisted.');
}

const supabase = supabaseUrl && supabaseKey 
    ? createClient(supabaseUrl, supabaseKey)
    : null;

async function storeSnapshot(provider, healthScore, status) {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('snapshots')
        .insert({
            provider,
            health_score: healthScore,
            status,
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

module.exports = {
    supabase,
    storeSnapshot,
    storeIncident,
    storeNews
};
