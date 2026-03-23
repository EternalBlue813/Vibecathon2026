const express = require('express');
const axios = require('axios');
const cors = require('cors');
const xml2js = require('xml2js');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache to avoid hitting APIs too frequently
let cache = {
    timestamp: 0,
    data: {
        aws: { status: 'Unknown', incidents: [], regionImpact: {} },
        azure: { status: 'Unknown', incidents: [], regionImpact: {} },
        gcp: { status: 'Unknown', incidents: [], regionImpact: {} },
        cloudflare: { status: 'Unknown', incidents: [], regionImpact: {} },
        akamai: { status: 'Unknown', incidents: [], regionImpact: {} },
        fastly: { status: 'Unknown', incidents: [], regionImpact: {} }
    }
};

let simulations = {};

const CACHE_DURATION = 30 * 1000; // 30 seconds

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
    return 'NA'; // Default to NA if unknown (or Global)
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

// Generic fetcher for Atlassian Statuspage APIs (Cloudflare, Fastly, Akamai)
async function fetchStatusPage(name, url, newsQuery) {
    try {
        const [statusResponse, news] = await Promise.all([
            axios.get(url),
            fetchNews(newsQuery)
        ]);

        const data = statusResponse.data;
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

        // Calculate health based on components
        const components = data.components || [];
        const totalComponents = components.length || 100;
        const operationalComponents = components.filter(c => c.status === 'operational').length;
        const healthScore = totalComponents > 0 ? operationalComponents / totalComponents : 1;

        const status = data.status.indicator === 'none' ? 'Healthy' : 'Warning';

        return {
            status,
            healthScore,
            incidents,
            news,
            regionImpact
        };
    } catch (error) {
        console.error(`${name} Fetch Error:`, error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], news: [], regionImpact: {} };
    }
}

async function fetchAWS() {
    try {
        const [statusResponse, news] = await Promise.all([
            axios.get('https://health.aws.amazon.com/public/currentevents', {
                responseType: 'arraybuffer'
            }),
            fetchNews('AWS')
        ]);

        // AWS returns UTF-16 encoded JSON (Big Endian)
        const decoder = new TextDecoder('utf-16be');
        const jsonString = decoder.decode(statusResponse.data);
        const incidentsData = JSON.parse(jsonString);

        // Filter for active incidents if needed, though this endpoint usually returns current ones
        // The structure is usually an array of event objects
        const incidents = incidentsData.map(i => ({
            name: i.service || i.eventTypeCode || 'Unknown Issue',
            link: `https://health.aws.amazon.com/health/status`, // AWS doesn't always give direct links in this feed
            region: getRegion(i.service ? i.service : '') // AWS public feed doesn't always have region in service name, but sometimes does
        }));

        const regionImpact = {};
        incidents.forEach(inc => {
            if (inc.region) {
                regionImpact[inc.region] = (regionImpact[inc.region] || 0) + 1;
            }
        });

        const healthScore = Math.max(0, (TOTAL_SERVICES_AWS - incidents.length) / TOTAL_SERVICES_AWS);
        const status = incidents.length > 0 ? 'Warning' : 'Healthy';

        return {
            status,
            healthScore,
            incidents,
            news,
            regionImpact
        };
    } catch (error) {
        console.error('AWS Fetch Error:', error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], news: [], regionImpact: {} };
    }
}

async function fetchGCP() {
    try {
        const [statusResponse, news] = await Promise.all([
            axios.get('https://status.cloud.google.com/incidents.json'),
            fetchNews('Google Cloud')
        ]);

        const allIncidents = statusResponse.data;
        // Filter for open incidents
        const openIncidents = allIncidents.filter(i => !i.end);

        const incidents = openIncidents.map(i => ({
            name: i.external_desc || i.service_name || 'Service Issue',
            link: `https://status.cloud.google.com/incident/${i.id}`, // Construct link if ID exists
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

        return {
            status,
            healthScore,
            incidents,
            news,
            regionImpact
        };
    } catch (error) {
        console.error('GCP Fetch Error:', error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], news: [], regionImpact: {} };
    }
}

async function fetchAzure() {
    try {
        const [statusResponse, news] = await Promise.all([
            axios.get('https://azure.status.microsoft/en-us/status/feed/'),
            fetchNews('Azure')
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

        return {
            status,
            healthScore,
            incidents,
            news,
            regionImpact
        };
    } catch (error) {
        console.error('Azure Fetch Error:', error.message);
        return { status: 'Unknown', healthScore: 0, incidents: [], news: [], regionImpact: {} };
    }
}

async function updateStatus() {
    const now = Date.now();
    if (now - cache.timestamp < CACHE_DURATION) {
        return cache.data;
    }

    console.log('Fetching fresh data...');
    const [aws, gcp, azure, cloudflare, akamai, fastly] = await Promise.all([
        fetchAWS(),
        fetchGCP(),
        fetchAzure(),
        fetchStatusPage('Cloudflare', 'https://www.cloudflarestatus.com/api/v2/summary.json', 'Cloudflare'),
        fetchStatusPage('Akamai', 'https://www.akamaistatus.com/api/v2/summary.json', 'Akamai'),
        fetchStatusPage('Fastly', 'https://www.fastlystatus.com/api/v2/summary.json', 'Fastly')
    ]);

    cache = {
        timestamp: now,
        data: { aws, gcp, azure, cloudflare, akamai, fastly }
    };
    return cache.data;
}

app.get('/status', async (req, res) => {
    const data = await updateStatus();
    // Deep copy to avoid mutating cache
    const responseData = JSON.parse(JSON.stringify(data));

    // Apply simulations
    for (const [provider, regions] of Object.entries(simulations)) {
        if (responseData[provider]) {
            for (const [region, count] of Object.entries(regions)) {
                responseData[provider].regionImpact[region] = (responseData[provider].regionImpact[region] || 0) + count;
                responseData[provider].status = 'Warning';
                responseData[provider].healthScore = Math.max(0, responseData[provider].healthScore - (count * 0.05));
                // Add fake incidents
                for (let i = 0; i < count; i++) {
                    responseData[provider].incidents.unshift({
                        name: `[SIMULATION] ${provider.toUpperCase()} Outage in ${region}`,
                        link: '#',
                        region: region
                    });
                }
            }
        }
    }
    res.json(responseData);
});

app.post('/simulate', (req, res) => {
    const { provider, region } = req.body;
    if (!simulations[provider]) simulations[provider] = {};
    simulations[provider][region] = (simulations[provider][region] || 0) + 5;
    res.json({ success: true, simulations });
});

app.post('/reset', (req, res) => {
    simulations = {};
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
