const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const MOBILE_VIEWPORT = { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PAGE_TIMEOUT = 20000;
const SETTLE_MS = 1500;
const SCREENSHOT_INTERVAL = parseInt(process.env.SCREENSHOT_INTERVAL) || 60 * 1000;
const MAX_SNAPSHOTS = parseInt(process.env.SCREENSHOT_HISTORY_LIMIT) || 120;
const SCREENSHOT_SCHEDULER_ENABLED = `${process.env.SCREENSHOT_SCHEDULER_ENABLED || 'false'}`.toLowerCase() === 'true';
const BUCKET = 'entity-image-snapshot';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const screenshotMeta = {};
const screenshotHistory = {};
const renderedPageText = {};

let browser = null;
let browserLaunchPromise = null;

const CHROME_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
];

function findSystemChrome() {
    for (const p of CHROME_PATHS) {
        try { if (fs.existsSync(p)) return p; } catch { }
    }
    return null;
}

async function ensureBrowser() {
    if (browser && browser.connected) return browser;
    if (browserLaunchPromise) return browserLaunchPromise;

    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
    ];

    browserLaunchPromise = (async () => {
        try {
            browser = await puppeteer.launch({ headless: 'new', args: launchArgs });
            console.log('[Screenshot] Launched Puppeteer bundled Chrome');
            return browser;
        } catch (e) {
            console.warn('[Screenshot] Bundled Chrome unavailable, trying system Chrome...');
        }

        const systemChrome = findSystemChrome();
        if (systemChrome) {
            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: systemChrome,
                args: launchArgs,
            });
            console.log(`[Screenshot] Launched system Chrome: ${systemChrome}`);
            return browser;
        }

        throw new Error('No Chrome/Chromium found. Install Google Chrome or run: npx puppeteer browsers install chrome');
    })();

    try {
        return await browserLaunchPromise;
    } finally {
        browserLaunchPromise = null;
    }
}

function ensureMeta(slug) {
    if (!screenshotMeta[slug]) {
        screenshotMeta[slug] = { capturedAt: null, url: null };
    }
}

function buildScreenshotPath(slug) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${slug}/${ts}-${suffix}.png`;
}

async function uploadToSupabase(slug, buffer, objectPath) {
    if (!supabase) {
        console.warn('[Screenshot] Supabase not configured, skipping upload');
        return null;
    }

    const filePath = objectPath || buildScreenshotPath(slug);

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, buffer, {
            contentType: 'image/png',
            upsert: false,
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

async function navigateForScreenshot(page, slug, primaryUrl, fallbackUrl) {
    const urls = [primaryUrl];
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
        urls.push(fallbackUrl);
    }

    let lastError = null;
    for (const tryUrl of urls) {
        try {
            await page.goto(tryUrl, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });
            await new Promise(r => setTimeout(r, SETTLE_MS));
            if (urls.length > 1 && tryUrl !== primaryUrl) {
                console.log(`[Screenshot] ${slug}: captured using fallback URL`);
            }
            return;
        } catch (e) {
            lastError = e;
            console.warn(`[Screenshot] ${slug}: navigate failed for ${tryUrl} — ${e.message}`);
        }
    }
    throw lastError || new Error('Navigation failed');
}

async function captureScreenshot(slug, primaryUrl, fallbackUrl) {
    if (!primaryUrl) return null;

    let page;
    try {
        const b = await ensureBrowser();
        page = await b.newPage();
        await page.setViewport(MOBILE_VIEWPORT);
        await page.setUserAgent(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        );
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-SG,en;q=0.9',
        });
        await page.evaluateOnNewDocument(() => {
            try {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            } catch { /* ignore */ }
        });

        await navigateForScreenshot(page, slug, primaryUrl, fallbackUrl);

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

        ensureMeta(slug);
        const objectPath = buildScreenshotPath(slug);
        const publicUrl = await uploadToSupabase(slug, buffer, objectPath);

        if (!publicUrl) return null;

        const capturedAt = new Date().toISOString();
        const urlWithBust = `${publicUrl}?t=${Date.now()}`;

        screenshotMeta[slug].capturedAt = capturedAt;
        screenshotMeta[slug].url = urlWithBust;

        if (!screenshotHistory[slug]) screenshotHistory[slug] = [];
        screenshotHistory[slug].push({ path: objectPath, capturedAt, url: urlWithBust });
        if (screenshotHistory[slug].length > MAX_SNAPSHOTS) {
            screenshotHistory[slug].shift();
        }

        console.log(`[Screenshot] ${slug}: uploaded ${objectPath} at ${capturedAt}`);
        return { capturedAt, url: urlWithBust };
    } catch (err) {
        console.error(`[Screenshot] ${slug}: failed -`, err.message);
        return null;
    } finally {
        if (page) {
            try { await page.close(); } catch { }
        }
    }
}

async function captureAll(entityConfig) {
    const slugs = Object.keys(entityConfig);
    if (slugs.length === 0) return;

    console.log(`[Screenshot] Starting capture cycle for ${slugs.length} entities...`);
    for (const slug of slugs) {
        const cfg = entityConfig[slug];
        const statusUrl = cfg.statusUrl || null;
        const fallbackUrl = cfg.url || null;
        if (statusUrl || fallbackUrl) {
            await captureScreenshot(slug, statusUrl, fallbackUrl);
        }
    }
    console.log('[Screenshot] Capture cycle complete.');
}

function getCapturedAtMs(slug) {
    const ts = screenshotMeta[slug]?.capturedAt;
    if (!ts) return 0;
    const ms = new Date(ts).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

async function captureIfStale(slug, primaryUrl, fallbackUrl, minIntervalMs = SCREENSHOT_INTERVAL) {
    const lastMs = getCapturedAtMs(slug);
    if (lastMs > 0 && Date.now() - lastMs < Math.max(0, minIntervalMs)) {
        return getMeta(slug);
    }
    return captureScreenshot(slug, primaryUrl, fallbackUrl);
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

    if (!SCREENSHOT_SCHEDULER_ENABLED) {
        console.log('[Screenshot] Scheduler disabled (set SCREENSHOT_SCHEDULER_ENABLED=true to enable global capture cycles)');
        return;
    }

    intervalHandle = setInterval(() => {
        captureAll(getEntityConfig()).catch(err =>
            console.error('[Screenshot] Scheduled capture error:', err.message)
        );
    }, SCREENSHOT_INTERVAL);

    console.log(`[Screenshot] Scheduler started (every ${SCREENSHOT_INTERVAL / 1000}s, keep ${MAX_SNAPSHOTS} in-memory entries, bucket: ${BUCKET})`);
}

async function shutdown() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    if (browser) {
        try { await browser.close(); } catch { }
        browser = null;
    }
}

module.exports = { startScheduler, captureScreenshot, captureIfStale, getMeta, getAllMeta, getHistory, getRenderedText, shutdown };
