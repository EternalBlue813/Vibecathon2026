const API_URL = '/status';
const CONFIG_URL = '/api/config';
const POLL_INTERVAL = 120000;

let entityConfig = {};

const GRID_MAP = {
    bank:  'grid-banks',
    cloud: 'grid-cloud',
    cdn:   'grid-cdn',
};

document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    buildTiles();
    buildSimButtons();
    await fetchData();
    setInterval(fetchData, POLL_INTERVAL);
});

async function loadConfig() {
    try {
        const res = await fetch(CONFIG_URL);
        entityConfig = await res.json();
    } catch (e) {
        console.error('Failed to load entity config:', e);
        entityConfig = {};
    }
}

function buildTiles() {
    for (const [slug, cfg] of Object.entries(entityConfig)) {
        const gridId = GRID_MAP[cfg.category];
        const grid = document.getElementById(gridId);
        if (!grid) continue;

        const tile = document.createElement('a');
        tile.href = `detail.html?entity=${slug}`;
        tile.className = 'status-tile unknown';
        tile.id = `tile-${slug}`;
        tile.setAttribute('aria-label', `${cfg.name} status`);

        tile.innerHTML = `
            <div class="tile-status-dot"></div>
            <span class="tile-name">${cfg.name}</span>
            <span class="tile-label">Loading</span>
        `;

        grid.appendChild(tile);
    }
}

function buildSimButtons() {
    const group = document.getElementById('sim-buttons');
    if (!group) return;

    for (const [slug, cfg] of Object.entries(entityConfig)) {
        const btn = document.createElement('button');
        btn.className = 'danger-btn';
        btn.textContent = `Down ${cfg.name}`;
        btn.addEventListener('click', () => triggerSpike(slug));
        group.appendChild(btn);
    }

    const resetBtn = document.createElement('button');
    resetBtn.className = 'secondary';
    resetBtn.textContent = 'Reset All';
    resetBtn.addEventListener('click', resetAll);
    group.appendChild(resetBtn);
}

async function fetchData() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        for (const [slug, info] of Object.entries(data)) {
            updateTile(slug, info);
        }

        updateGlobalStatus(data);
    } catch (error) {
        console.error('Failed to fetch status:', error);
    }
}

function updateTile(slug, data) {
    const tile = document.getElementById(`tile-${slug}`);
    if (!tile) return;

    const isHealthy = data.status === 'Healthy';
    const isUnknown = data.status === 'Unknown';

    tile.classList.remove('up', 'down', 'unknown');
    const label = tile.querySelector('.tile-label');

    if (isUnknown) {
        tile.classList.add('unknown');
        if (label) label.textContent = 'Unknown';
    } else if (isHealthy) {
        tile.classList.add('up');
        if (label) label.textContent = 'Operational';
    } else {
        tile.classList.add('down');
        if (label) label.textContent = 'Issues';
    }
}

function updateGlobalStatus(data) {
    const allHealthy = Object.values(data).every(d => d.status === 'Healthy');
    const globalStatus = document.getElementById('global-status');
    const indicator = document.querySelector('.live-indicator');

    if (allHealthy) {
        globalStatus.innerText = 'All Systems Operational';
        indicator.style.color = '#22c55e';
        indicator.style.background = 'rgba(34, 197, 94, 0.15)';
    } else {
        globalStatus.innerText = 'Service Disruptions Detected';
        indicator.style.color = '#ef4444';
        indicator.style.background = 'rgba(239, 68, 68, 0.15)';
    }
}

async function triggerSpike(provider) {
    try {
        await fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, region: 'AS' })
        });
        await fetchData();
    } catch (e) {
        console.error(e);
    }
}

async function resetAll() {
    try {
        await fetch('/reset', { method: 'POST' });
        await fetchData();
    } catch (e) {
        console.error(e);
    }
}
