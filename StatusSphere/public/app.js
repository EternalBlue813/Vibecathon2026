const API_URL = '/status';
const CONFIG_URL = '/api/config';
const HEADLINE_URL = '/api/headline';
const CHAT_URL = '/api/chat';
const POLL_INTERVAL = 120000;
const HEADLINE_INTERVAL = 120000;

let entityConfig = {};
let chatHistory = [];

const GRID_MAP = {
    bank:  'grid-banks',
    cloud: 'grid-cloud',
    cdn:   'grid-cdn',
};

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    buildTiles();
    buildSimButtons();
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

// --- Status polling ---
async function fetchData() {
    try {
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

// --- Outage summary ---
function updateOutageSummary(data) {
    const el = document.getElementById('outage-text');
    const section = document.getElementById('outage-summary');
    if (!el || !section) return;

    const issues = [];
    for (const [slug, info] of Object.entries(data)) {
        if (info.status && info.status !== 'Healthy' && info.status !== 'Unknown') {
            const name = entityConfig[slug]?.name || slug;
            issues.push(name);
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

// --- Simulation ---
async function triggerSpike(provider) {
    try {
        await fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, region: 'AS' })
        });
        await fetchData();
        fetchHeadline();
    } catch (e) {
        console.error(e);
    }
}

async function resetAll() {
    try {
        await fetch('/reset', { method: 'POST' });
        await fetchData();
        fetchHeadline();
    } catch (e) {
        console.error(e);
    }
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
