const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const logFile = 'test_scrape.log';

function log(msg) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}

async function testFetch(name, url) {
    log(`\n--- Testing ${name} (${url}) ---`);
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            timeout: 10000
        });
        log(`[SUCCESS] Status Code: ${response.status}`);

        const $ = cheerio.load(response.data);
        const title = $('title').text().trim();
        log(`[SUCCESS] Page Title: ${title}`);

        if (title.toLowerCase().includes('cloudflare') ||
            title.toLowerCase().includes('just a moment') ||
            title.toLowerCase().includes('access denied') ||
            title.toLowerCase().includes('security') ||
            title.toLowerCase().includes('captcha')) {
            log(`[WARNING] Opened page, but title suggests bot protection.`);
        }
    } catch (error) {
        if (error.response) {
            log(`[ERROR] Blocked or failed! Status Code: ${error.response.status}`);
            log(`[ERROR] Status Text: ${error.response.statusText}`);
        } else {
            log(`[ERROR] Request failed completely: ${error.message}`);
        }
    }
}

async function runTests() {
    try {
        fs.unlinkSync(logFile);
    } catch (e) { }

    await testFetch('DBS', 'https://www.dbs.com.sg/personal/support/bank-service-maintenance.html');
    await testFetch('DBS Main', 'https://www.dbs.com.sg/index/default.page');
    await testFetch('OCBC', 'https://www.ocbc.com/personal-banking/');
    await testFetch('UOB', 'https://www.uob.com.sg/personal/index.page');
}

runTests();
