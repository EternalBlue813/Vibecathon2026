// Configuration
const API_URL = '/status';
const POLL_INTERVAL = 30000; // 30 seconds
const MAX_HISTORY = 20; // Keep last 20 status checks (10 mins)

// State
const state = {
    aws: { history: [], currentStatus: 'Unknown', incidents: [] },
    azure: { history: [], currentStatus: 'Unknown', incidents: [] },
    gcp: { history: [], currentStatus: 'Unknown', incidents: [] },
    cloudflare: { history: [], currentStatus: 'Unknown', incidents: [] },
    akamai: { history: [], currentStatus: 'Unknown', incidents: [] },
    fastly: { history: [], currentStatus: 'Unknown', incidents: [] }
};

// Chart Instances
const charts = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initCharts(); // Initial fetch
    setInterval(fetchData, POLL_INTERVAL);
});

function initCharts() {
    ['aws', 'azure', 'gcp', 'cloudflare', 'akamai', 'fastly'].forEach(provider => {
        const ctx = document.getElementById(`chart-${provider}`).getContext('2d');

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
        gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

        charts[provider] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(MAX_HISTORY).fill(''),
                datasets: [{
                    label: 'Status History',
                    data: Array(MAX_HISTORY).fill(1), // Default to healthy
                    borderColor: '#38bdf8',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: 2,
                    stepped: true, // Stepped line for binary status
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

    // Update State
    const isHealthy = status === 'Healthy';
    const numericStatus = data.healthScore !== undefined ? data.healthScore : (isHealthy ? 1 : 0);

    state[provider].history.push(numericStatus);
    if (state[provider].history.length > MAX_HISTORY) {
        state[provider].history.shift();
    }

    // Update Chart
    const chart = charts[provider];
    chart.data.datasets[0].data = state[provider].history;

    // Color logic
    const color = isHealthy ? '#22c55e' : '#ef4444'; // Green or Red
    chart.data.datasets[0].borderColor = color;
    const ctx = chart.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, isHealthy ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    chart.data.datasets[0].backgroundColor = gradient;

    chart.update();

    // Update Text Stats
    const reportElem = document.getElementById(`reports-${provider}`);
    const peakElem = document.getElementById(`peak-${provider}`);

    // "Current Reports" -> "Active Incidents"
    // "24h Peak" -> "Status"
    reportElem.previousElementSibling.innerText = "Active Incidents";
    peakElem.previousElementSibling.innerText = "Status";

    // Render Incidents List
    if (incidents.length > 0) {
        reportElem.innerHTML = `<ul class="incident-list">
            ${incidents.map(inc => `<li><a href="${inc.link}" target="_blank">${inc.name}</a></li>`).join('')}
        </ul>`;
    } else {
        reportElem.innerText = "0";
    }

    peakElem.innerText = status;

    // Update Badge
    const badge = document.getElementById(`status-${provider}`);
    if (!isHealthy) {
        badge.className = 'status-badge danger';
        badge.innerText = 'Issues Detected';
    } else {
        badge.className = 'status-badge healthy';
        badge.innerText = 'Healthy';
    }

    // Update News
    const newsList = document.getElementById(`news-${provider}`);
    if (data.news && data.news.length > 0) {
        newsList.innerHTML = data.news.map(item => `
            <li>
                <a href="${item.link}" target="_blank" rel="noopener noreferrer">
                    <span class="news-title">${item.title}</span>
                    <span class="news-meta">
                        <span class="news-source">${item.source}</span>
                        <span class="news-date">${new Date(item.pubDate).toLocaleDateString()}</span>
                    </span>
                </a>
            </li>
        `).join('');
    } else {
        newsList.innerHTML = '<li class="no-news">No recent news found</li>';
    }
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
