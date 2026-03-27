require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const xml2js = require('xml2js');
const { supabase, storeSnapshot, storeIncident, storeNews } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const ENTITY_CONFIG = {
    dbs:        { name: 'DBS',        category: 'bank', simulated: true },
    ocbc:       { name: 'OCBC',       category: 'bank', simulated: true },
    uob:        { name: 'UOB',        category: 'bank', simulated: true },
    citi:       { name: 'Citi',       category: 'bank', simulated: true },
    scb:        { name: 'SCB',        category: 'bank', simulated: true },
    hsbc:       { name: 'HSBC',       category: 'bank', simulated: true },
    maybank:    { name: 'Maybank',    category: 'bank', simulated: true },
    aws:        { name: 'AWS',        category: 'cloud' },
    azure:      { name: 'Azure',      category: 'cloud' },
    gcp:        { name: 'Google Cloud', category: 'cloud' },
    cloudflare: { name: 'Cloudflare', category: 'cdn' },
    akamai:     { name: 'Akamai',     category: 'cdn' },
};

const ALL_SLUGS = Object.keys(ENTITY_CONFIG);
const BANK_SLUGS = ALL_SLUGS.filter(s => ENTITY_CONFIG[s].category === 'bank');
const CLOUD_SLUGS = ALL_SLUGS.filter(s => ENTITY_CONFIG[s].category === 'cloud');
const CDN_SLUGS = ALL_SLUGS.filter(s => ENTITY_CONFIG[s].category === 'cdn');

function defaultEntry() {
    return { status: 'Unknown', healthScore: 1, incidents: [], news: [], regionImpact: {} };
}

let cache = {
    timestamp: 0,
    data: Object.fromEntries(ALL_SLUGS.map(s => [s, defaultEntry()]))
};

let simulations = {};

const CACHE_DURATION = parseInt(process.env.CACHE_DURATION) || 120 * 1000;
const NEWS_FETCH_INTERVAL = 30 * 60 * 1000;
let lastNewsFetch = 0;

const TOTAL_SERVICES_AWS = 200;
const TOTAL_SERVICES_GCP = 180;
const TOTAL_SERVICES_AZURE = 200;

const REGION_KEYWORDS = {
    'NA': ['us-', 'north america', 'canada', 'mexico', 'united states', 'usa', 'ashburn', 'chicago', 'dallas', 'denver', 'los angeles', 'miami', 'new york', 'seattle', 'san jose', 'toronto', 'atlanta'],
    'SA': ['sa-', 'south america', 'brazil', 'sao paulo', 'buenos aires', 'lima', 'santiago', 'bogota'],
    'EU': ['eu-', 'europe', 'uk', 'london', 'frankfurt', 'ireland', 'paris', 'stockholm', 'milan', 'zurich', 'madrid', 'amsterdam', 'berlin', 'brussels', 'copenhagen', 'dublin', 'helsinki', 'lisbon', 'marseille', 'oslo', 'prague', 'sofia', 'vienna', 'warsaw'],
    'AS': ['ap-', 'asia', 'japan', 'tokyo', 'seoul', 'singapore', 'mumbai', 'hong kong', 'india', 'china', 'bangkok', 'jakarta', 'kuala lumpur', 'manila', 'osaka', 'taipei'],
    'OC': ['australia', 'sydney', 'melbourne', 'oceania', 'auckland', 'brisbane', 'perth'],
    'AF': ['af-', 'africa', 'cape town', 'johannesburg', 'cairo', 'lagos']
};

function getRegion(text) {
    if (!text) return null;
    text = text.toLowerCase();
    for (const [code, keywords] of Object.entries(REGION_KEYWORDS)) {
        if (keywords.some(k => text.includes(k))) {
            return code;
        }
    }
    return 'NA';
}

async function fetchNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' outage OR downtime')}&hl=en-US&gl=US&ceid=US:en`;
        const response = await axios.get(url);
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);
        const items = result.rss.channel[0].item || [];

        return items.slice(0, 3).map(item => ({
            title: item.title[0],
            link: item.link[0],
            pubDate: item.pubDate[0],
            source: item.source ? item.source[0]._ : 'News'
        }));
    } catch (error) {
        console.error(`News Fetch Error (${query}):`, error.message);
        return [];
    }
}

async function fetchStatusPage(name, url) {
    try {
        const response = await axios.get(url);
        const data = response.data;
        const incidents = (data.incidents || []).map(i => ({
            name: i.name,
            link: i.shortlink || i.page_id ? `${data.page.url}/incidents/${i.id}` : data.page.url,
            region: getRegion(i.name + ' ' + (i.components ? i.components.map(c => c.name).join(' ') : ''))
        }));

        const regionImpact = {};
        incidents.forEach(inc => {
            if (inc.region) {
                regionImpact[inc.region] = (regionImpact[inc.region] || 0) + 1;
            }
        });

        const components = data.components || [];
        const totalComponents = components.length || 100;
        const operationalComponents = components.filter(c => c.status === 'operational').length;
        const healthScore = totalComponents > 0 ? operationalComponents / totalComponents : 1;
        const status = data.status.indicator === 'none' ? 'Healthy' : 'Warning';

        return { status, healthScore, incidents, regionImpact };
    } catch (error) {
        console.error(`${name} Fetch Error:`, error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], regionImpact: {} };
    }
}

async function fetchAWS() {
    try {
        const [statusResponse] = await Promise.all([
            axios.get('https://health.aws.amazon.com/public/currentevents', {
                responseType: 'arraybuffer'
            })
        ]);

        const decoder = new TextDecoder('utf-16be');
        const jsonString = decoder.decode(statusResponse.data);
        const incidentsData = JSON.parse(jsonString);

        const incidents = incidentsData.map(i => ({
            name: i.service || i.eventTypeCode || 'Unknown Issue',
            link: 'https://health.aws.amazon.com/health/status',
            region: getRegion(i.service ? i.service : '')
        }));

        const regionImpact = {};
        incidents.forEach(inc => {
            if (inc.region) {
                regionImpact[inc.region] = (regionImpact[inc.region] || 0) + 1;
            }
        });

        const healthScore = Math.max(0, (TOTAL_SERVICES_AWS - incidents.length) / TOTAL_SERVICES_AWS);
        const status = incidents.length > 0 ? 'Warning' : 'Healthy';

        return { status, healthScore, incidents, regionImpact };
    } catch (error) {
        console.error('AWS Fetch Error:', error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], regionImpact: {} };
    }
}

async function fetchGCP() {
    try {
        const [statusResponse] = await Promise.all([
            axios.get('https://status.cloud.google.com/incidents.json')
        ]);

        const allIncidents = statusResponse.data;
        const openIncidents = allIncidents.filter(i => !i.end);

        const incidents = openIncidents.map(i => ({
            name: i.external_desc || i.service_name || 'Service Issue',
            link: `https://status.cloud.google.com/incident/${i.id}`,
            region: getRegion(i.external_desc + ' ' + (i.service_name || ''))
        }));

        const regionImpact = {};
        incidents.forEach(inc => {
            if (inc.region) {
                regionImpact[inc.region] = (regionImpact[inc.region] || 0) + 1;
            }
        });

        const healthScore = Math.max(0, (TOTAL_SERVICES_GCP - incidents.length) / TOTAL_SERVICES_GCP);
        const status = incidents.length > 0 ? 'Warning' : 'Healthy';

        return { status, healthScore, incidents, regionImpact };
    } catch (error) {
        console.error('GCP Fetch Error:', error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], regionImpact: {} };
    }
}

async function fetchAzure() {
    try {
        const [statusResponse] = await Promise.all([
            axios.get('https://azure.status.microsoft/en-us/status/feed/')
        ]);

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(statusResponse.data);
        const items = result.rss.channel[0].item || [];

        const incidents = items.map(i => ({
            name: i.title[0],
            link: i.link[0],
            region: getRegion(i.title[0] + ' ' + (i.description ? i.description[0] : ''))
        }));

        const regionImpact = {};
        incidents.forEach(inc => {
            if (inc.region) {
                regionImpact[inc.region] = (regionImpact[inc.region] || 0) + 1;
            }
        });

        const healthScore = Math.max(0, (TOTAL_SERVICES_AZURE - incidents.length) / TOTAL_SERVICES_AZURE);
        const status = incidents.length > 0 ? 'Warning' : 'Healthy';

        return { status, healthScore, incidents, regionImpact };
    } catch (error) {
        console.error('Azure Fetch Error:', error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], regionImpact: {} };
    }
}

async function fetchAllStatus() {
    const [aws, gcp, azure, cloudflare, akamai] = await Promise.all([
        fetchAWS(),
        fetchGCP(),
        fetchAzure(),
        fetchStatusPage('Cloudflare', 'https://www.cloudflarestatus.com/api/v2/summary.json'),
        fetchStatusPage('Akamai', 'https://www.akamaistatus.com/api/v2/summary.json'),
    ]);

    const result = { aws, gcp, azure, cloudflare, akamai };

    for (const slug of BANK_SLUGS) {
        result[slug] = { status: 'Healthy', healthScore: 1, incidents: [], regionImpact: {} };
    }

    return result;
}

async function fetchAllNews() {
    const newsMap = {};
    for (const slug of [...CLOUD_SLUGS, ...CDN_SLUGS]) {
        newsMap[slug] = await fetchNews(ENTITY_CONFIG[slug].name);
    }
    for (const slug of BANK_SLUGS) {
        newsMap[slug] = await fetchNews(ENTITY_CONFIG[slug].name + ' bank');
    }
    return newsMap;
}

async function persistToDatabase(data) {
    for (const [provider, providerData] of Object.entries(data)) {
        const { status, healthScore, incidents } = providerData;

        const snapshotId = await storeSnapshot(provider, healthScore, status);

        for (const incident of incidents) {
            await storeIncident(snapshotId, provider, incident.name, incident.link, incident.region);
        }
    }
}

async function persistNewsToDatabase(newsData) {
    const snapshotIds = {};

    if (supabase) {
        for (const provider of Object.keys(newsData)) {
            const { data, error } = await supabase
                .from('snapshots')
                .select('id')
                .eq('provider', provider)
                .order('polled_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!error && data?.id) {
                snapshotIds[provider] = data.id;
            }
        }
    }

    for (const [provider, articles] of Object.entries(newsData)) {
        const snapshotId = snapshotIds[provider] || null;
        for (const article of articles) {
            await storeNews(snapshotId, provider, article.title, article.link, article.source, article.pubDate);
        }
    }
}

async function updateStatus() {
    const now = Date.now();
    if (now - cache.timestamp < CACHE_DURATION) {
        return cache.data;
    }

    console.log('[StatusSphere] Fetching fresh status data...');
    const statusData = await fetchAllStatus();
    for (const provider of Object.keys(statusData)) {
        const existingNews = cache.data[provider]?.news || [];
        cache.data[provider] = {
            ...statusData[provider],
            news: existingNews
        };
    }
    cache.timestamp = now;

    await persistToDatabase(statusData);

    return cache.data;
}

async function updateNews() {
    const now = Date.now();
    if (now - lastNewsFetch < NEWS_FETCH_INTERVAL) {
        return cache.data;
    }

    console.log('[StatusSphere] Fetching fresh news data...');
    const newsData = await fetchAllNews();
    lastNewsFetch = now;

    for (const [provider, articles] of Object.entries(newsData)) {
        if (Array.isArray(articles) && articles.length > 0) {
            if (cache.data[provider]) {
                cache.data[provider].news = articles;
            }
        }
    }

    await persistNewsToDatabase(newsData);

    return cache.data;
}

// --- API Routes ---

app.get('/api/config', (req, res) => {
    res.json(ENTITY_CONFIG);
});

app.get('/status', async (req, res) => {
    const statusData = await updateStatus();
    await updateNews();

    const responseData = JSON.parse(JSON.stringify(statusData));

    for (const [provider, regions] of Object.entries(simulations)) {
        if (!responseData[provider]) {
            responseData[provider] = defaultEntry();
        }
        for (const [region, count] of Object.entries(regions)) {
            responseData[provider].regionImpact[region] = (responseData[provider].regionImpact[region] || 0) + count;
            responseData[provider].status = 'Warning';
            responseData[provider].healthScore = Math.max(0, responseData[provider].healthScore - (count * 0.05));
            for (let i = 0; i < count; i++) {
                responseData[provider].incidents.unshift({
                    name: `[SIMULATION] ${(ENTITY_CONFIG[provider]?.name || provider).toUpperCase()} Outage in ${region}`,
                    link: '#',
                    region: region
                });
            }
        }
    }
    res.json(responseData);
});

app.post('/simulate', (req, res) => {
    const { provider, region } = req.body;
    if (!ENTITY_CONFIG[provider]) {
        return res.status(400).json({ error: 'Unknown provider' });
    }
    if (!simulations[provider]) simulations[provider] = {};
    simulations[provider][region || 'AS'] = (simulations[provider][region || 'AS'] || 0) + 5;
    res.json({ success: true, simulations });
});

app.post('/reset', (req, res) => {
    simulations = {};
    res.json({ success: true });
});

app.get('/history', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }

    const result = {};

    for (const slug of ALL_SLUGS) {
        const { data, error } = await supabase
            .from('snapshots')
            .select('id, provider, polled_at, health_score, status')
            .eq('provider', slug)
            .order('polled_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error(`[Supabase] Failed to fetch history for ${slug}:`, error.message);
            result[slug] = [];
        } else {
            result[slug] = data ? data.reverse() : [];
        }
    }

    res.json(result);
});

app.get('/news/:entity', async (req, res) => {
    const entity = req.params.entity;
    if (!ENTITY_CONFIG[entity]) {
        return res.status(404).json({ error: 'Unknown entity' });
    }

    const query = ENTITY_CONFIG[entity].category === 'bank'
        ? ENTITY_CONFIG[entity].name + ' bank'
        : ENTITY_CONFIG[entity].name;

    const articles = await fetchNews(query);
    res.json(articles);
});

app.listen(PORT, () => {
    console.log(`[StatusSphere] Server running at http://localhost:${PORT}`);
    console.log(`[StatusSphere] Monitoring: ${ALL_SLUGS.join(', ')}`);
    console.log(`[StatusSphere] Status polling: every ${CACHE_DURATION / 1000} seconds`);
    console.log(`[StatusSphere] News polling: every ${NEWS_FETCH_INTERVAL / 60000} minutes`);
});
