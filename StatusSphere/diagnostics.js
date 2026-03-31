try {
    const axios = require('axios');
    console.log("Axios successfully loaded:", !!axios);
} catch (e) {
    console.log("Failed to load axios:", e.message);
}

try {
    const cheerio = require('cheerio');
    console.log("Cheerio successfully loaded:", !!cheerio);
} catch (e) {
    console.log("Failed to load cheerio:", e.message);
}
