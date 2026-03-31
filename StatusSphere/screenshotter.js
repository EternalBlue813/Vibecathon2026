const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const MOBILE_VIEWPORT = { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PAGE_TIMEOUT = 20000;
const SCREENSHOT_INTERVAL = 60 * 1000;
const MAX_SNAPSHOTS = 5;
const BUCKET = 'entity-image-snapshot';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const screenshotMeta = {};
const screenshotHistory = {};
const renderedPageText = {};

let browser = null;

async function ensureBrowser() {
    if (browser && browser.connected) return browser;
    browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
        ],
    });
    return browser;
}

function getSlotIndex(slug) {
    if (!screenshotMeta[slug]) {
        screenshotMeta[slug] = { slot: 0, capturedAt: null, url: null };
    }
    const nextSlot = (screenshotMeta[slug].slot % MAX_SNAPSHOTS) + 1;
    screenshotMeta[slug].slot = nextSlot;
    return nextSlot;
}

async function uploadToSupabase(slug, buffer, slotIndex) {
    if (!supabase) {
        console.warn('[Screenshot] Supabase not configured, skipping upload');
        return null;
    }

    const filePath = `${slug}/${slotIndex}.png`;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, buffer, {
            contentType: 'image/png',
            upsert: true,
        });

    if (error) {
        console.error(`[Screenshot] Upload failed for ${filePath}:`, error.message);
        return null;
    }

    const { data: urlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(filePath);

    return urlData?.publicUrl || null;
}

async function captureScreenshot(slug, url) {
    if (!url) return null;

    let page;
    try {
        const b = await ensureBrowser();
        page = await b.newPage();
        await page.setViewport(MOBILE_VIEWPORT);
        await page.setUserAgent(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        );

        await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });
        await new Promise(r => setTimeout(r, 1500));

        const buffer = await page.screenshot({ type: 'png', fullPage: false });

        const extractedText = await page.evaluate(() => {
            const bannerSelectors = [
                '[role="alert"]',
                '[aria-live="assertive"]',
                '[aria-live="polite"]',
                '.banner', '.alert', '.notice', '.notification', '.warning',
                '[class*="banner"]', '[class*="alert"]', '[class*="notice"]',
                '[class*="notification"]', '[class*="warning"]',
                '.message', '[class*="message"]',
            ];
            const parts = [];

            const title = document.title || '';
            if (title) parts.push(`[TITLE] ${title}`);

            const headings = document.querySelectorAll('h1, h2, h3, h4');
            headings.forEach(h => {
                const t = h.innerText?.trim();
                if (t) parts.push(`[HEADING] ${t}`);
            });

            for (const sel of bannerSelectors) {
                document.querySelectorAll(sel).forEach(el => {
                    const t = el.innerText?.trim();
                    if (t && t.length > 5) parts.push(`[BANNER] ${t}`);
                });
            }

            const bodyText = document.body?.innerText?.trim() || '';
            if (bodyText) parts.push(`[BODY] ${bodyText.slice(0, 4000)}`);

            return parts.join('\n');
        });

        renderedPageText[slug] = {
            text: extractedText || '',
            extractedAt: new Date().toISOString(),
        };

        const slotIndex = getSlotIndex(slug);
        const publicUrl = await uploadToSupabase(slug, buffer, slotIndex);

        if (!publicUrl) return null;

        const capturedAt = new Date().toISOString();
        const urlWithBust = `${publicUrl}?t=${Date.now()}`;

        screenshotMeta[slug].capturedAt = capturedAt;
        screenshotMeta[slug].url = urlWithBust;

        if (!screenshotHistory[slug]) screenshotHistory[slug] = [];
        const existing = screenshotHistory[slug].findIndex(s => s.slot === slotIndex);
        if (existing !== -1) screenshotHistory[slug].splice(existing, 1);
        screenshotHistory[slug].push({ slot: slotIndex, capturedAt, url: urlWithBust });
        if (screenshotHistory[slug].length > MAX_SNAPSHOTS) {
            screenshotHistory[slug].shift();
        }

        console.log(`[Screenshot] ${slug}: slot ${slotIndex}/${MAX_SNAPSHOTS} uploaded at ${capturedAt}`);
        return { capturedAt, url: urlWithBust };
    } catch (err) {
        console.error(`[Screenshot] ${slug}: failed -`, err.message);
        return null;
    } finally {
        if (page) {
            try { await page.close(); } catch {}
        }
    }
}

async function captureAll(entityConfig) {
    const slugs = Object.keys(entityConfig);
    if (slugs.length === 0) return;

    console.log(`[Screenshot] Starting capture cycle for ${slugs.length} entities...`);
    for (const slug of slugs) {
        const cfg = entityConfig[slug];
        const url = cfg.statusUrl || cfg.url || null;
        if (url) {
            await captureScreenshot(slug, url);
        }
    }
    console.log('[Screenshot] Capture cycle complete.');
}

function getMeta(slug) {
    const meta = screenshotMeta[slug];
    if (!meta || !meta.capturedAt) return null;
    return { capturedAt: meta.capturedAt, url: meta.url };
}

function getAllMeta() {
    const result = {};
    for (const [slug, meta] of Object.entries(screenshotMeta)) {
        if (meta.capturedAt) {
            result[slug] = { capturedAt: meta.capturedAt, url: meta.url };
        }
    }
    return result;
}

function getHistory(slug) {
    const entries = screenshotHistory[slug];
    if (!entries || entries.length === 0) return [];
    return [...entries].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
}

function getRenderedText(slug) {
    return renderedPageText[slug] || null;
}

let intervalHandle = null;

function startScheduler(getEntityConfig) {
    if (intervalHandle) return;

    captureAll(getEntityConfig()).catch(err =>
        console.error('[Screenshot] Initial capture error:', err.message)
    );

    intervalHandle = setInterval(() => {
        captureAll(getEntityConfig()).catch(err =>
            console.error('[Screenshot] Scheduled capture error:', err.message)
        );
    }, SCREENSHOT_INTERVAL);

    console.log(`[Screenshot] Scheduler started (every ${SCREENSHOT_INTERVAL / 1000}s, ${MAX_SNAPSHOTS} slots per entity, bucket: ${BUCKET})`);
}

async function shutdown() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    if (browser) {
        try { await browser.close(); } catch {}
        browser = null;
    }
}

module.exports = { startScheduler, captureScreenshot, getMeta, getAllMeta, getHistory, getRenderedText, shutdown };
