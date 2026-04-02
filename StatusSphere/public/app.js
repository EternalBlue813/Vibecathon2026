const API_URL = '/status';
const CONFIG_URL = '/api/config';
const INTERVALS_URL = '/api/config/intervals';
const HEADLINE_URL = '/api/headline';
const CHAT_URL = '/api/chat';
const CHAT_RESPONSE_FORMAT = 'markdown';
let POLL_INTERVAL = 120000;
let HEADLINE_INTERVAL = 120000;
const ENTITY_CONFIG_CACHE_KEY = 'statussphere:entity-config:v1';
const ENTITY_CONFIG_CACHE_TTL = 10 * 60 * 1000;

let entityConfig = {};
let chatHistory = [];
let configSignature = '';
let lastConfigFetch = 0;

const GRID_MAP = {
    bank:  'grid-banks',
    cloud: 'grid-cloud',
    cdn:   'grid-cdn',
};

const STATUS_TILE_CONFIG = {
    Unknown: { className: 'unknown', label: 'Unknown' },
    Healthy: { className: 'up', label: 'Operational' },
    Maintenance: { className: 'maintenance', label: 'Under Maintenance' },
    Partial: { className: 'partial', label: 'Partial Outage' },
};

async function loadIntervals() {
    try {
        const res = await fetch(INTERVALS_URL);
        const intervals = await res.json();
        POLL_INTERVAL = intervals.statusPollInterval;
        HEADLINE_INTERVAL = intervals.headlinePollInterval;
    } catch (e) {
        console.error('Failed to load intervals:', e);
    }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadIntervals();
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
    const now = Date.now();
    const canUseMemory = Object.keys(entityConfig).length > 0 && now - lastConfigFetch < ENTITY_CONFIG_CACHE_TTL;
    if (canUseMemory) return;

    try {
        const res = await fetch(CONFIG_URL);
        const nextConfig = await res.json();
        if (!nextConfig || typeof nextConfig !== 'object') {
            throw new Error('Invalid entity config response');
        }
        entityConfig = nextConfig;
        lastConfigFetch = now;
        writeEntityConfigCache(entityConfig);
    } catch (e) {
        console.error('Failed to load entity config:', e);
        const cached = readEntityConfigCache();
        entityConfig = cached || {};
        lastConfigFetch = cached ? now : 0;
    }
}

function readEntityConfigCache() {
    try {
        const raw = localStorage.getItem(ENTITY_CONFIG_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.expiresAt || Date.now() > parsed.expiresAt) {
            localStorage.removeItem(ENTITY_CONFIG_CACHE_KEY);
            return null;
        }
        return parsed.data || null;
    } catch (e) {
        return null;
    }
}

function writeEntityConfigCache(config) {
    try {
        localStorage.setItem(ENTITY_CONFIG_CACHE_KEY, JSON.stringify({
            expiresAt: Date.now() + ENTITY_CONFIG_CACHE_TTL,
            data: config
        }));
    } catch (e) {
        // ignore quota/storage errors
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
        if (Date.now() - lastConfigFetch >= ENTITY_CONFIG_CACHE_TTL) {
            await refreshConfigIfChanged();
        }
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

    tile.classList.remove('up', 'down', 'partial', 'maintenance', 'unknown');
    const label = tile.querySelector('.tile-label');

    const state = STATUS_TILE_CONFIG[data.status] || { className: 'down', label: 'Down' };
    tile.classList.add(state.className);
    if (label) label.textContent = state.label;
}

function updateGlobalStatus(data) {
    const statuses = Object.values(data).map(d => d.status);
    if (statuses.length === 0) {
        const globalStatus = document.getElementById('global-status');
        const indicator = document.querySelector('.live-indicator');
        globalStatus.innerText = 'Loading System Status';
        indicator.style.color = '#94a3b8';
        indicator.style.background = 'rgba(148, 163, 184, 0.15)';
        return;
    }

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

    if (Object.keys(data).length === 0) {
        section.classList.remove('has-issues', 'all-clear');
        el.innerHTML = 'Loading monitored entities and current incidents...';
        return;
    }

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
            const data = await requestChatReply();

            responseEl.innerHTML = formatChatText(data.reply);
            responseEl.classList.remove('loading');

            if (data.guardrail === 'input_blocked') {
                responseEl.classList.add('guardrail');
            }

            chatHistory.push({ role: 'assistant', content: data.reply });
        } catch (err) {
            responseEl.innerHTML = formatChatText('Sorry, something went wrong. Please try again.');
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
            const data = await requestChatReply();

            typingEl.querySelector('p').innerHTML = formatChatText(data.reply);
            typingEl.classList.remove('typing');

            if (data.guardrail === 'input_blocked') {
                typingEl.classList.add('guardrail');
            }

            chatHistory.push({ role: 'assistant', content: data.reply });
        } catch (err) {
            typingEl.querySelector('p').innerHTML = formatChatText('Sorry, something went wrong. Please try again.');
            typingEl.classList.remove('typing');
        }
    });
}

async function requestChatReply() {
    const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: chatHistory.slice(-10),
            responseFormat: CHAT_RESPONSE_FORMAT,
        })
    });
    return res.json();
}

function appendMessage(role, text, format = CHAT_RESPONSE_FORMAT) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = `<p>${formatChatText(text)}</p>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function setAssistantMessageContent(container, text, format = CHAT_RESPONSE_FORMAT) {
    const html = renderRichText(text, format);
    container.innerHTML = `<div class="msg-rich">${html}</div>`;
}

function setRichTextContent(container, text, format = CHAT_RESPONSE_FORMAT) {
    container.innerHTML = renderRichText(text, format);
}

function renderRichText(text, format = CHAT_RESPONSE_FORMAT) {
    const content = `${text || ''}`;
    const preferred = `${format || ''}`.toLowerCase();

    if (preferred === 'html' || looksLikeHtml(content)) {
        return sanitizeAllowedHtml(content);
    }
    return renderMarkdown(content);
}

function looksLikeHtml(text) {
    return /<([a-z][a-z0-9-]*)(\s[^>]*)?>/i.test(`${text || ''}`);
}

function sanitizeAllowedHtml(rawHtml) {
    const template = document.createElement('template');
    template.innerHTML = `${rawHtml || ''}`;

    const allowedTags = new Set(['P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'CODE', 'PRE', 'A', 'BR', 'H3', 'H4', 'BLOCKQUOTE']);

    function isSafeHref(href) {
        if (!href) return false;
        const trimmed = href.trim();
        return /^https:\/\//i.test(trimmed) || /^http:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed);
    }

    function walk(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName;
            if (!allowedTags.has(tag)) {
                const parent = node.parentNode;
                if (parent) {
                    while (node.firstChild) {
                        parent.insertBefore(node.firstChild, node);
                    }
                    parent.removeChild(node);
                }
                return;
            }

            const attrs = [...node.attributes];
            for (const attr of attrs) {
                if (tag === 'A' && attr.name === 'href') {
                    if (!isSafeHref(attr.value)) {
                        node.removeAttribute('href');
                    }
                    continue;
                }
                node.removeAttribute(attr.name);
            }

            if (tag === 'A') {
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            }
        }

        const children = [...node.childNodes];
        for (const child of children) {
            walk(child);
        }
    }

    walk(template.content);
    return template.innerHTML;
}

function renderMarkdown(markdown) {
    const text = `${markdown || ''}`.replace(/\r\n/g, '\n').trim();
    if (!text) return '';

    const lines = text.split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trimEnd();
        if (!line.trim()) {
            i += 1;
            continue;
        }

        if (line.startsWith('```')) {
            const codeLines = [];
            i += 1;
            while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
                codeLines.push(lines[i]);
                i += 1;
            }
            i += 1;
            blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        const orderedMatch = line.match(/^\d+\.\s+/);
        const bulletMatch = line.match(/^[-*]\s+/);
        if (orderedMatch || bulletMatch) {
            const ordered = Boolean(orderedMatch);
            const tag = ordered ? 'ol' : 'ul';
            const items = [];
            while (i < lines.length) {
                const current = lines[i].trim();
                if (!current) break;
                const itemMatch = ordered ? current.match(/^\d+\.\s+(.+)$/) : current.match(/^[-*]\s+(.+)$/);
                if (!itemMatch) break;
                items.push(`<li>${formatInlineMarkdown(itemMatch[1])}</li>`);
                i += 1;
            }
            blocks.push(`<${tag}>${items.join('')}</${tag}>`);
            continue;
        }

        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            const level = Math.min(4, headingMatch[1].length);
            blocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
            i += 1;
            continue;
        }

        const paragraphLines = [line.trim()];
        i += 1;
        while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('```') && !/^(#{1,4})\s+/.test(lines[i].trim()) && !/^[-*]\s+/.test(lines[i].trim()) && !/^\d+\.\s+/.test(lines[i].trim())) {
            paragraphLines.push(lines[i].trim());
            i += 1;
        }
        blocks.push(`<p>${formatInlineMarkdown(paragraphLines.join(' '))}</p>`);
    }

    return blocks.join('');
}

function formatInlineMarkdown(text) {
    let html = escapeHtml(`${text || ''}`);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Render newlines from the AI response as visible line breaks in HTML.
// We escape first, then add <br/> for each newline to preserve formatting safely.
function formatChatText(text) {
    const normalized = String(text ?? '').replace(/\r\n/g, '\n');
    let html = escapeHtml(normalized);

    // Minimal markdown rendering for readability (safe: all source was escaped).
    // Bold: **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Inline code: `code`
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

    // Newline -> visible break
    html = html.replace(/\n/g, '<br/>');
    return html;
}
