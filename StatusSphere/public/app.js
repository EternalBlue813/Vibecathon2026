// Configuration
const API_URL = '/status';
const HISTORY_API = '/history';
const POLL_INTERVAL = 120000; // 2 minutes
const HISTORY_REFRESH_INTERVAL = 300000; // 5 minutes
const MAX_HISTORY = 20; // Keep latest 20 points

// State
const state = {
    aws: { history: [], currentStatus: 'Unknown', incidents: [], lastFetch: null, fromCache: false },
    azure: { history: [], currentStatus: 'Unknown', incidents: [], lastFetch: null, fromCache: false },
    gcp: { history: [], currentStatus: 'Unknown', incidents: [], lastFetch: null, fromCache: false },
    cloudflare: { history: [], currentStatus: 'Unknown', incidents: [], lastFetch: null, fromCache: false },
    akamai: { history: [], currentStatus: 'Unknown', incidents: [], lastFetch: null, fromCache: false },
    fastly: { history: [], currentStatus: 'Unknown', incidents: [], lastFetch: null, fromCache: false }
};

// Chart Instances
const charts = {};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initCharts();
    await fetchHistory();
    Object.keys(state).forEach(p => state[p].fromCache = false);
    fetchData();
    setInterval(fetchData, POLL_INTERVAL);
    setInterval(fetchHistory, HISTORY_REFRESH_INTERVAL);
    setInterval(updateLastFetchTimers, 10000);
});

function initCharts() {
    ['aws', 'azure', 'gcp', 'cloudflare', 'akamai', 'fastly'].forEach(provider => {
        const ctx = document.getElementById(`chart-${provider}`).getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

        charts[provider] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(MAX_HISTORY).fill(''),
                datasets: [{
                    label: 'Status History',
                    data: Array(MAX_HISTORY).fill(1),
                    borderColor: '#38bdf8',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: 2,
                    stepped: true,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    x: { display: false },
                    y: {
                        display: true,
                        min: 0,
                        max: 1.2,
                        ticks: {
                            callback: function (value) {
                                if (value === 1) return 'UP';
                                if (value === 0) return 'DOWN';
                                return '';
                            },
                            color: '#64748b',
                            font: { size: 10 }
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    }
                }
            }
        });
    });
}

async function fetchHistory() {
    try {
        const response = await fetch(HISTORY_API);
        if (!response.ok) return;

        const data = await response.json();
        let hasData = false;

        for (const [provider, snapshots] of Object.entries(data)) {
            if (state[provider] && snapshots.length > 0) {
                const history = snapshots.map(s => s.health_score);
                const lastSnapshot = snapshots[snapshots.length - 1];
                const latestStatus = lastSnapshot.status || 'Unknown';

                state[provider].history = history;
                state[provider].currentStatus = latestStatus;
                state[provider].lastFetch = new Date();

                if (charts[provider]) {
                    charts[provider].data.datasets[0].data = history;
                    charts[provider].update();
                }

                updateProviderUI(provider, latestStatus, history[history.length - 1] ?? 1, []);
                hasData = true;
            }
        }

        if (hasData) {
            console.log('[StatusSphere] Loaded history from database');
        }
    } catch (error) {
        console.error('[StatusSphere] Failed to fetch history:', error);
    }
}

function updateProviderUI(provider, status, healthScore, incidents) {
    const isHealthy = status === 'Healthy';
    const isUnknown = status === 'Unknown';

    const reportElem = document.getElementById(`reports-${provider}`);
    const peakElem = document.getElementById(`peak-${provider}`);
    const lastFetchElem = document.getElementById(`lastfetch-${provider}`);

    if (reportElem) reportElem.previousElementSibling.innerText = "Active Incidents";
    if (peakElem) peakElem.previousElementSibling.innerText = "Status";
    if (lastFetchElem) lastFetchElem.previousElementSibling.innerText = "Last Fetch";

    if (reportElem) {
        reportElem.innerText = String(incidents.length || 0);
    }

    if (peakElem) {
        peakElem.innerText = isUnknown ? 'Unknown' : status;
    }

    if (lastFetchElem && state[provider].lastFetch) {
        lastFetchElem.innerText = formatTimeAgo(state[provider].lastFetch);
    }

    const badge = document.getElementById(`status-${provider}`);
    if (badge) {
        if (isUnknown) {
            badge.className = 'status-badge unknown';
            badge.innerText = 'Unknown';
        } else if (!isHealthy) {
            badge.className = 'status-badge danger';
            badge.innerText = 'Issues Detected';
        } else {
            badge.className = 'status-badge healthy';
            badge.innerText = 'Healthy';
        }
    }

    const chart = charts[provider];
    if (chart) {
        const color = isUnknown ? '#64748b' : (isHealthy ? '#22c55e' : '#ef4444');
        chart.data.datasets[0].borderColor = color;
        const ctx = chart.ctx;
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, isUnknown ? 'rgba(100, 116, 139, 0.5)' : (isHealthy ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'));
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        chart.data.datasets[0].backgroundColor = gradient;
        chart.update();
    }
}

async function fetchData() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        updateProvider('aws', data.aws);
        updateProvider('azure', data.azure);
        updateProvider('gcp', data.gcp);
        updateProvider('cloudflare', data.cloudflare);
        updateProvider('akamai', data.akamai);
        updateProvider('fastly', data.fastly);

        updateGlobalStatus(data);
        updateMap(data);
    } catch (error) {
        console.error('Failed to fetch status:', error);
    }
}

function updateMap(data) {
    const providers = {
        aws: { color: '255, 165, 0', data: data.aws }, // Orange
        azure: { color: '128, 0, 128', data: data.azure }, // Purple
        gcp: { color: '66, 133, 244', data: data.gcp }, // Blue
        cloudflare: { color: '255, 140, 0', data: data.cloudflare }, // Dark Orange
        akamai: { color: '0, 0, 255', data: data.akamai }, // Blue
        fastly: { color: '0, 100, 0', data: data.fastly } // Dark Green
    };

    const regions = ['na', 'sa', 'eu', 'af', 'as', 'oc'];

    regions.forEach(region => {
        const point = document.getElementById(`region-${region}`);
        let weightedR = 0, weightedG = 0, weightedB = 0;
        let totalIntensity = 0;

        Object.values(providers).forEach(p => {
            // Check if p.data exists before accessing regionImpact
            if (p.data && p.data.regionImpact) {
                const impact = p.data.regionImpact[region.toUpperCase()] || 0;
                if (impact > 0) {
                    const intensity = Math.min(impact * 0.2, 1); // Cap at 1
                    const [r, g, b] = p.color.split(',').map(Number);

                    weightedR += r * intensity;
                    weightedG += g * intensity;
                    weightedB += b * intensity;
                    totalIntensity += intensity;
                }
            }
        });

        if (totalIntensity > 0) {
            const finalR = Math.round(weightedR / totalIntensity);
            const finalG = Math.round(weightedG / totalIntensity);
            const finalB = Math.round(weightedB / totalIntensity);

            // Boost alpha for visibility, cap at 0.9
            const alpha = Math.min(0.9, totalIntensity * 1.5);

            point.style.background = `radial-gradient(circle, rgba(${finalR},${finalG},${finalB},${alpha}) 0%, rgba(${finalR},${finalG},${finalB},0) 70%)`;
            point.style.opacity = 1;
            point.style.boxShadow = `0 0 30px 10px rgba(${finalR},${finalG},${finalB},${alpha * 0.5})`;
        } else {
            point.style.opacity = 0;
            point.style.boxShadow = 'none';
        }
    });
}

function updateProvider(provider, data) {
    const { status, incidents } = data;

    state[provider].lastFetch = new Date();
    const isHealthy = status === 'Healthy';
    const isUnknown = status === 'Unknown';
    const numericStatus = data.healthScore !== undefined ? data.healthScore : (isUnknown ? 1 : (isHealthy ? 1 : 0));

    if (!state[provider].fromCache) {
        state[provider].history.push(numericStatus);
        if (state[provider].history.length > MAX_HISTORY) {
            state[provider].history.shift();
        }
    }

    state[provider].currentStatus = status;
    state[provider].fromCache = false;

    updateProviderUI(provider, status, numericStatus, incidents);

    const newsList = document.getElementById(`news-${provider}`);
    const incidentItems = (incidents || []).map(inc => ({
        type: 'incident',
        title: inc.name,
        link: inc.link,
        source: 'Status Feed',
        pubDate: new Date().toISOString()
    }));

    const newsItems = (data.news || []).map(item => ({
        type: 'news',
        title: item.title,
        link: item.link,
        source: item.source,
        pubDate: item.pubDate
    }));

    const feedItems = [...incidentItems, ...newsItems].slice(0, 6);

    if (feedItems.length > 0) {
        newsList.innerHTML = feedItems.map(item => `
            <li>
                <a href="${item.link}" target="_blank" rel="noopener noreferrer">
                    ${item.type === 'incident' ? '<span class="feed-pill">Incident</span>' : ''}
                    <span class="news-title">${item.title}</span>
                    <span class="news-meta">
                        <span class="news-source">${item.source}</span>
                        <span class="news-date">${new Date(item.pubDate).toLocaleDateString()}</span>
                    </span>
                </a>
            </li>
        `).join('');
    } else {
        newsList.innerHTML = '<li class="no-news">No recent incidents or news found</li>';
    }
}

function formatTimeAgo(date) {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

function updateLastFetchTimers() {
    ['aws', 'azure', 'gcp', 'cloudflare', 'akamai', 'fastly'].forEach(provider => {
        const elem = document.getElementById(`lastfetch-${provider}`);
        if (elem && state[provider].lastFetch) {
            elem.innerText = formatTimeAgo(state[provider].lastFetch);
        }
    });
}

function updateGlobalStatus(data) {
    const allHealthy = Object.values(data).every(d => d.status === 'Healthy');
    const globalStatus = document.getElementById('global-status');
    const indicator = document.querySelector('.live-indicator');

    if (allHealthy) {
        globalStatus.innerText = "All Systems Operational";
        indicator.style.color = "#22c55e";
        indicator.style.background = "rgba(34, 197, 94, 0.2)";
    } else {
        globalStatus.innerText = "Service Disruptions Detected";
        indicator.style.color = "#ef4444";
        indicator.style.background = "rgba(239, 68, 68, 0.2)";
    }
}

// Simulation Controls
async function triggerSpike(provider, region = 'NA') {
    try {
        await fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, region })
        });
        fetchData(); // Immediate update
    } catch (e) {
        console.error(e);
    }
}

async function resetAll() {
    try {
        await fetch('/reset', { method: 'POST' });
        fetchData();
    } catch (e) {
        console.error(e);
    }
}

// Ensure controls are visible
const controls = document.querySelector('.controls-area');
if (controls) controls.style.display = 'block';
