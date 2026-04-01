const CONFIG_URL = '/api/config';
const RELOAD_ENTITIES_URL = '/api/entities/reload';
const ENTITY_META_URL = '/api/entity/';
const STATUS_URL = '/status';
const HISTORY_URL = '/history';
const SCREENSHOT_URL = '/api/screenshot/';
const MAX_HISTORY = 20;
const POLL_INTERVAL = 120000;
const SCREENSHOT_POLL_INTERVAL = 15000;

const BADGE_CONFIG = {
    Healthy: { className: 'up', label: 'Operational' },
    Unknown: { className: 'unknown', label: 'Unknown' },
    Maintenance: { className: 'maintenance', label: 'Under Maintenance' },
    Partial: { className: 'partial', label: 'Intermittent/Partial Outage' },
};

let chart = null;
let entitySlug = null;
let entityMeta = null;

async function reloadEntitiesFromDb() {
    try {
        await fetch(RELOAD_ENTITIES_URL, { method: 'POST' });
    } catch (e) {
        console.error('Failed to reload entities:', e);
    }
}

function applyEntityMetaToPage() {
    const name = entityMeta?.name || entitySlug;
    const mainUrl = entityMeta?.url || '#';
    const statusUrl = entityMeta?.statusUrl || '#';

    document.getElementById('entity-name').textContent = name;
    document.title = `StatusSphere | ${name}`;

    const mainLink = document.getElementById('entity-main-url');
    const statusLink = document.getElementById('entity-status-url');
    if (mainLink) {
        mainLink.href = mainUrl;
        mainLink.textContent = mainUrl;
    }
    if (statusLink) {
        statusLink.href = statusUrl;
        statusLink.textContent = statusUrl;
    }

    updateLastFetch(entityMeta?.lastFetch || null);
}

async function refreshEntityDetailsFromDb() {
    try {
        const res = await fetch(`${ENTITY_META_URL}${encodeURIComponent(entitySlug)}`);
        if (!res.ok) {
            return;
        }
        entityMeta = await res.json();
        applyEntityMetaToPage();
    } catch (e) {
        console.error('Failed to load entity details:', e);
    }
}

async function refreshEntityMeta() {
    try {
        const cfgRes = await fetch(CONFIG_URL);
        const config = await cfgRes.json();
        entityMeta = config[entitySlug] || null;
    } catch (e) {
        console.error('Failed to load config', e);
    }

    applyEntityMetaToPage();
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    entitySlug = params.get('entity');

    if (!entitySlug) {
        document.getElementById('entity-name').textContent = 'No entity specified';
        return;
    }

    await reloadEntitiesFromDb();
    await refreshEntityMeta();
    await refreshEntityDetailsFromDb();

    initChart();
    initCarousel();
    await loadHistory();
    await fetchStatus();
    await fetchNews();
    await fetchScreenshot();

    setInterval(fetchStatus, POLL_INTERVAL);
    setInterval(fetchScreenshot, SCREENSHOT_POLL_INTERVAL);
});

function formatTimestamp(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hr = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mon}/${day} ${hr}:${min}`;
}

function scoreToColor(v) {
    if (v >= 0.9) return '#22c55e';
    if (v >= 0.3) return '#f59e0b';
    return '#ef4444';
}

function initChart() {
    const ctx = document.getElementById('history-chart').getContext('2d');

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Health Score',
                data: [],
                borderColor: '#64748b',
                backgroundColor: 'rgba(100,116,139,0.08)',
                borderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                pointBackgroundColor: [],
                pointBorderColor: [],
                pointBorderWidth: 1.5,
                stepped: true,
                fill: true,
                segment: {
                    borderColor(ctx) {
                        const prev = ctx.p0.parsed.y;
                        const curr = ctx.p1.parsed.y;
                        const worst = Math.min(prev, curr);
                        return scoreToColor(worst);
                    }
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const v = ctx.parsed.y;
                            if (v >= 0.9) return 'Healthy';
                            if (v >= 0.3) return 'Intermittent/Partial Outage';
                            return 'Down';
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: {
                        color: '#64748b',
                        font: { size: 9 },
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 8,
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.04)' }
                },
                y: {
                    display: true,
                    min: 0,
                    max: 1.1,
                    ticks: {
                        stepSize: 0.5,
                        callback(value) {
                            if (value === 1) return 'Healthy';
                            if (value === 0.5) return 'Partial Outage';
                            if (value === 0) return 'Down';
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
}

async function loadHistory() {
    try {
        const res = await fetch(HISTORY_URL);
        if (!res.ok) return;
        const data = await res.json();

        const snapshots = data[entitySlug];
        if (snapshots && snapshots.length > 0) {
            chart.data.labels = snapshots.map(s => formatTimestamp(s.polled_at));
            chart.data.datasets[0].data = snapshots.map(s => s.health_score);
            colorChart();
            chart.update();
        }
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

async function fetchStatus() {
    try {
        await refreshEntityMeta();
        const res = await fetch(STATUS_URL);
        const data = await res.json();
        const info = data[entitySlug];
        if (!info) return;

        await refreshEntityDetailsFromDb();

        updateBadge(info.status);
        updateSummary(info);
        updateLastFetch(entityMeta?.lastFetch || null);
        updateMaintenanceOverlay(info.status);

        const score = info.healthScore !== undefined ? info.healthScore : (info.status === 'Healthy' ? 1 : 0);
        chart.data.labels.push(formatTimestamp(new Date().toISOString()));
        chart.data.datasets[0].data.push(score);
        if (chart.data.datasets[0].data.length > MAX_HISTORY) {
            chart.data.datasets[0].data.shift();
            chart.data.labels.shift();
        }
        colorChart();
        chart.update();
    } catch (e) {
        console.error('Failed to fetch status:', e);
    }
}

function updateLastFetch(fetchedAt) {
    const el = document.getElementById('entity-last-fetch');
    if (!el) return;
    if (!fetchedAt) {
        el.textContent = '-';
        return;
    }

    const dt = new Date(fetchedAt);
    el.textContent = Number.isNaN(dt.getTime()) ? fetchedAt : dt.toLocaleString();
}

function colorChart() {
    const ds = chart.data.datasets[0];
    ds.pointBackgroundColor = ds.data.map(v => scoreToColor(v));
    ds.pointBorderColor = ds.data.map(v => scoreToColor(v));
}

function updateBadge(status) {
    const badge = document.getElementById('entity-badge');
    badge.classList.remove('up', 'down', 'partial', 'maintenance', 'unknown');

    const state = BADGE_CONFIG[status] || { className: 'down', label: 'Down' };
    badge.classList.add(state.className);
    badge.textContent = state.label;
}

const REGION_DISPLAY_LABELS = {
    NA: 'North America',
    SA: 'South America',
    EU: 'Europe',
    AS: 'Asia',
    OC: 'Oceania',
    AF: 'Africa',
};

function formatRegionImpactNote(regionImpact) {
    const keys = Object.keys(regionImpact || {});
    if (keys.length === 0) return '';
    const labels = keys.map((code) => REGION_DISPLAY_LABELS[code] || code);
    return ` Affected regions: ${labels.join(', ')}.`;
}

function updateMaintenanceOverlay(status) {
    const wrapper = document.getElementById('chart-wrapper');
    if (!wrapper) return;
    if (status === 'Maintenance') {
        wrapper.classList.add('maintenance-active');
    } else {
        wrapper.classList.remove('maintenance-active');
    }
}

function updateSummary(info) {
    const el = document.getElementById('llm-summary');
    const incidents = info.incidents || [];
    const name = entityMeta?.name || entitySlug;

    if (incidents.length === 0) {
        el.textContent = `No active incidents reported for ${name}. The service appears to be operating normally.`;
        return;
    }

    const lines = incidents.slice(0, 5).map(i => {
        let desc = i.name || 'Unknown Issue';
        if (i.awsLocation) desc += ` — Region: ${i.awsLocation}`;
        return desc;
    });

    const regionNote = formatRegionImpactNote(info.regionImpact);

    let statusLabel;
    if (info.status === 'Maintenance') {
        const sgt = info.maintenanceInfo?.detectedAt || new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
        statusLabel = `is currently under scheduled maintenance (as of ${sgt} SGT)`;
    } else if (info.status === 'Partial') {
        statusLabel = 'is experiencing a partial outage — some services are affected';
    } else if (info.status === 'Down') {
        statusLabel = 'is currently down';
    } else {
        statusLabel = 'is currently experiencing issues';
    }
    el.textContent = `${name} ${statusLabel}.${regionNote} Active incidents: ${lines.join('; ')}. Monitor this page for updates.`;
}

async function fetchNews() {
    const list = document.getElementById('news-list');
    try {
        const res = await fetch(`/news/${entitySlug}`);
        const articles = await res.json();

        if (!Array.isArray(articles) || articles.length === 0) {
            list.innerHTML = '<li class="no-news">No recent media reports found.</li>';
            return;
        }

        list.innerHTML = articles.map(a => `
            <li>
                <a href="${a.link}" target="_blank" rel="noopener noreferrer">
                    <span class="news-title">${a.title}</span>
                    <span class="news-meta">
                        <span class="news-source">${a.source}</span>
                        <span class="news-date">${new Date(a.pubDate).toLocaleDateString()}</span>
                    </span>
                </a>
            </li>
        `).join('');
    } catch (e) {
        list.innerHTML = '<li class="no-news">Failed to load news.</li>';
        console.error('Failed to fetch news:', e);
    }
}

let screenshotSnapshots = [];
let screenshotIndex = -1;

function renderScreenshotSlide() {
    const img = document.getElementById('screenshot-img');
    const fallback = document.getElementById('preview-fallback');
    const timestampEl = document.getElementById('screenshot-timestamp');
    const counterEl = document.getElementById('carousel-counter');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');

    if (screenshotSnapshots.length === 0) {
        if (img) img.style.display = 'none';
        if (fallback) { fallback.style.display = 'block'; fallback.textContent = 'Capturing first screenshot...'; }
        if (timestampEl) timestampEl.textContent = 'Last capture: waiting...';
        if (counterEl) counterEl.textContent = '';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    const snap = screenshotSnapshots[screenshotIndex];
    if (!snap) return;

    if (img) {
        img.src = snap.url;
        img.style.display = 'block';
    }
    if (fallback) fallback.style.display = 'none';

    if (timestampEl && snap.capturedAt) {
        const dt = new Date(snap.capturedAt);
        timestampEl.textContent = `Captured: ${dt.toLocaleString()}`;
    }

    if (counterEl) {
        counterEl.textContent = `${screenshotIndex + 1} / ${screenshotSnapshots.length}`;
    }

    if (prevBtn) prevBtn.disabled = screenshotIndex <= 0;
    if (nextBtn) nextBtn.disabled = screenshotIndex >= screenshotSnapshots.length - 1;
}

function initCarousel() {
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (screenshotIndex > 0) {
                screenshotIndex--;
                renderScreenshotSlide();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (screenshotIndex < screenshotSnapshots.length - 1) {
                screenshotIndex++;
                renderScreenshotSlide();
            }
        });
    }
}

async function fetchScreenshot() {
    if (!entitySlug) return;

    try {
        const res = await fetch(`${SCREENSHOT_URL}${encodeURIComponent(entitySlug)}/history`);
        const data = await res.json();

        if (Array.isArray(data.snapshots) && data.snapshots.length > 0) {
            const wasAtEnd = screenshotIndex === screenshotSnapshots.length - 1 || screenshotSnapshots.length === 0;
            screenshotSnapshots = data.snapshots;
            if (wasAtEnd) {
                screenshotIndex = screenshotSnapshots.length - 1;
            }
        }
    } catch (e) {
        console.error('Failed to fetch screenshot history:', e);
    }

    renderScreenshotSlide();
}
