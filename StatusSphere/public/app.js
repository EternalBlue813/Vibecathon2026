const API_URL = '/status';
const CONFIG_URL = '/api/config';
const RELOAD_ENTITIES_URL = '/api/entities/reload';
const HEADLINE_URL = '/api/headline';
const CHAT_URL = '/api/chat';
const POLL_INTERVAL = 120000;
const HEADLINE_INTERVAL = 120000;

let entityConfig = {};
let chatHistory = [];
let configSignature = '';

const GRID_MAP = {
    bank:  'grid-banks',
    cloud: 'grid-cloud',
    cdn:   'grid-cdn',
};

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    await reloadEntitiesFromDb();
    await refreshConfigIfChanged();
    await fetchData();
    setInterval(fetchData, POLL_INTERVAL);

    fetchHeadline();
    setInterval(fetchHeadline, HEADLINE_INTERVAL);

    initAskBar();
    initChat();
});

// --- Config + Tiles ---
async function loadConfig() {
    try {
        const res = await fetch(CONFIG_URL);
        entityConfig = await res.json();
    } catch (e) {
        console.error('Failed to load entity config:', e);
        entityConfig = {};
    }
}

async function reloadEntitiesFromDb() {
    try {
        await fetch(RELOAD_ENTITIES_URL, { method: 'POST' });
    } catch (e) {
        console.error('Failed to reload entities:', e);
    }
}

function getConfigSignature(config) {
    return Object.entries(config)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([slug, cfg]) => `${slug}:${cfg.name}:${cfg.category}`)
        .join('|');
}

function renderTiles() {
    for (const gridId of Object.values(GRID_MAP)) {
        const grid = document.getElementById(gridId);
        if (grid) {
            grid.innerHTML = '';
        }
    }

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

async function refreshConfigIfChanged() {
    await loadConfig();
    const nextSignature = getConfigSignature(entityConfig);
    if (nextSignature !== configSignature) {
        configSignature = nextSignature;
        renderTiles();
    }
}

// --- Status polling ---
async function fetchData() {
    try {
        await refreshConfigIfChanged();
        const response = await fetch(API_URL);
        const data = await response.json();

        for (const [slug, info] of Object.entries(data)) {
            updateTile(slug, info);
        }
        updateGlobalStatus(data);
        updateOutageSummary(data);
    } catch (error) {
        console.error('Failed to fetch status:', error);
    }
}

function getPrimaryAwsLocation(data) {
    for (const incident of (data.incidents || [])) {
        if (incident?.awsLocation) return incident.awsLocation;
        const name = incident?.name || '';
        const match = name.match(/\(([^)]+)\)/);
        if (match?.[1]) return match[1].trim();
    }
    return null;
}

function getIssueSummary(slug, info) {
    const name = entityConfig[slug]?.name || slug;
    const awsLocation = slug === 'aws' ? getPrimaryAwsLocation(info) : null;
    if (awsLocation) {
        if (info.status === 'Partial') return `${name} (${awsLocation} AZ Down)`;
        if (info.status === 'Down') return `${name} (${awsLocation} Region Down)`;
    }
    return name;
}

function updateTile(slug, data) {
    const tile = document.getElementById(`tile-${slug}`);
    if (!tile) return;

    const st = data.status;

    tile.classList.remove('up', 'down', 'partial', 'maintenance', 'unknown');
    const label = tile.querySelector('.tile-label');
    const awsLocation = slug === 'aws' ? getPrimaryAwsLocation(data) : null;

    if (st === 'Unknown') {
        tile.classList.add('unknown');
        if (label) label.textContent = 'Unknown';
    } else if (st === 'Healthy') {
        tile.classList.add('up');
        if (label) label.textContent = 'Operational';
    } else if (st === 'Warning') {
        tile.classList.add('partial');
        if (label) label.textContent = 'Service Degradation';
    } else if (st === 'Maintenance') {
        tile.classList.add('maintenance');
        if (label) label.textContent = 'Under Maintenance';
    } else if (st === 'Partial') {
        tile.classList.add('partial');
        if (label) label.textContent = awsLocation ? `${awsLocation} AZ Down` : 'Partial Outage';
    } else {
        tile.classList.add('down');
        if (label) label.textContent = awsLocation ? `${awsLocation} Region Down` : 'Down';
    }
}

function updateGlobalStatus(data) {
    const statuses = Object.values(data).map(d => d.status);
    const allHealthy = statuses.every(s => s === 'Healthy');
    const hasDown = statuses.some(s => s === 'Down' || s === 'Warning');
    const hasMaint = statuses.some(s => s === 'Maintenance');
    const globalStatus = document.getElementById('global-status');
    const indicator = document.querySelector('.live-indicator');

    if (allHealthy) {
        globalStatus.innerText = 'All Systems Operational';
        indicator.style.color = '#22c55e';
        indicator.style.background = 'rgba(34, 197, 94, 0.15)';
    } else if (hasDown) {
        globalStatus.innerText = 'Service Disruptions Detected';
        indicator.style.color = '#ef4444';
        indicator.style.background = 'rgba(239, 68, 68, 0.15)';
    } else if (hasMaint) {
        globalStatus.innerText = 'Scheduled Maintenance in Progress';
        indicator.style.color = '#a855f7';
        indicator.style.background = 'rgba(168, 85, 247, 0.15)';
    } else {
        globalStatus.innerText = 'Partial Service Disruptions';
        indicator.style.color = '#f59e0b';
        indicator.style.background = 'rgba(245, 158, 11, 0.15)';
    }
}

// --- Outage summary ---
function updateOutageSummary(data) {
    const el = document.getElementById('outage-text');
    const section = document.getElementById('outage-summary');
    if (!el || !section) return;

    const issues = [];
    for (const [slug, info] of Object.entries(data)) {
        if (info.status && info.status !== 'Healthy' && info.status !== 'Unknown') {
            issues.push(getIssueSummary(slug, info));
        }
    }

    section.classList.remove('has-issues', 'all-clear');

    if (issues.length === 0) {
        section.classList.add('all-clear');
        el.innerHTML = '<strong>All clear</strong> — All monitored banks, cloud providers, and CDN services are operating normally.';
    } else {
        section.classList.add('has-issues');
        const names = issues.map(n => `<span class="outage-name">${n}</span>`).join(', ');
        el.innerHTML = `<strong>Active issues:</strong> ${names}`;
    }
}

// --- Inline ask bar ---
function initAskBar() {
    const form = document.getElementById('ask-form');
    const input = document.getElementById('ask-input');
    const responseEl = document.getElementById('ask-response');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        responseEl.classList.remove('hidden');
        responseEl.classList.remove('guardrail');
        responseEl.textContent = 'Thinking...';
        responseEl.classList.add('loading');

        chatHistory.push({ role: 'user', content: text });

        try {
            const res = await fetch(CHAT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistory.slice(-10) })
            });
            const data = await res.json();

            responseEl.textContent = data.reply;
            responseEl.classList.remove('loading');

            if (data.guardrail === 'input_blocked') {
                responseEl.classList.add('guardrail');
            }

            chatHistory.push({ role: 'assistant', content: data.reply });
        } catch (err) {
            responseEl.textContent = 'Sorry, something went wrong. Please try again.';
            responseEl.classList.remove('loading');
        }

        input.value = '';
    });
}

// --- Breaking-news ticker ---
async function fetchHeadline() {
    const el = document.getElementById('ticker-text');
    try {
        const res = await fetch(HEADLINE_URL);
        const data = await res.json();
        if (data.headline) {
            el.textContent = data.headline;
            restartTickerAnimation();
        }
    } catch (e) {
        console.error('Failed to fetch headline:', e);
    }
}

function restartTickerAnimation() {
    const el = document.getElementById('ticker-text');
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
}

// --- Chat widget ---
function initChat() {
    const fab = document.getElementById('chat-fab');
    const panel = document.getElementById('chat-panel');
    const closeBtn = document.getElementById('chat-close');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    fab.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            input.focus();
        }
    });

    closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';

        appendMessage('user', text);
        chatHistory.push({ role: 'user', content: text });

        const typingEl = appendMessage('assistant', '...');
        typingEl.classList.add('typing');

        try {
            const res = await fetch(CHAT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: chatHistory.slice(-10) })
            });
            const data = await res.json();

            typingEl.querySelector('p').textContent = data.reply;
            typingEl.classList.remove('typing');

            if (data.guardrail === 'input_blocked') {
                typingEl.classList.add('guardrail');
            }

            chatHistory.push({ role: 'assistant', content: data.reply });
        } catch (err) {
            typingEl.querySelector('p').textContent = 'Sorry, something went wrong. Please try again.';
            typingEl.classList.remove('typing');
        }
    });
}

function appendMessage(role, text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = `<p>${escapeHtml(text)}</p>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
