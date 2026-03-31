const CONFIG_URL = '/api/config';
const RELOAD_ENTITIES_URL = '/api/entities/reload';
const ENTITY_META_URL = '/api/entity/';
const STATUS_URL = '/status';
const HISTORY_URL = '/history';
const SCREENSHOT_URL = '/api/screenshot/';
const MAX_HISTORY = 20;
const POLL_INTERVAL = 120000;
const SCREENSHOT_POLL_INTERVAL = 15000;

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

function initChart() {
    const ctx = document.getElementById('history-chart').getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(MAX_HISTORY).fill(''),
            datasets: [{
                label: 'Health Score',
                data: Array(MAX_HISTORY).fill(1),
                borderColor: '#38bdf8',
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#38bdf8',
                stepped: true,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.parsed.y >= 0.9 ? 'UP' : 'DOWN'
                    }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    display: true,
                    min: 0,
                    max: 1.2,
                    ticks: {
                        callback(value) {
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
}

async function loadHistory() {
    try {
        const res = await fetch(HISTORY_URL);
        if (!res.ok) return;
        const data = await res.json();

        const snapshots = data[entitySlug];
        if (snapshots && snapshots.length > 0) {
            const scores = snapshots.map(s => s.health_score);
            chart.data.datasets[0].data = scores;
            colorChart(scores[scores.length - 1]);
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

        const score = info.healthScore !== undefined ? info.healthScore : (info.status === 'Healthy' ? 1 : 0);
        const chartData = chart.data.datasets[0].data;
        chartData.push(score);
        if (chartData.length > MAX_HISTORY) chartData.shift();
        colorChart(score);
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

function colorChart(latestScore) {
    const isUp = latestScore >= 0.9;
    const color = isUp ? '#22c55e' : '#ef4444';
    chart.data.datasets[0].borderColor = color;
    chart.data.datasets[0].pointBackgroundColor = color;

    const ctx = chart.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, isUp ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    chart.data.datasets[0].backgroundColor = gradient;
}

function updateBadge(status) {
    const badge = document.getElementById('entity-badge');
    badge.classList.remove('up', 'down', 'unknown');

    if (status === 'Healthy') {
        badge.classList.add('up');
        badge.textContent = 'Operational';
    } else if (status === 'Unknown') {
        badge.classList.add('unknown');
        badge.textContent = 'Unknown';
    } else {
        badge.classList.add('down');
        badge.textContent = 'Issues Detected';
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

    const incidentNames = incidents.slice(0, 5).map(i => i.name).join('; ');
    el.textContent = `${name} is currently experiencing issues. Active incidents: ${incidentNames}. Monitor this page for updates.`;
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
