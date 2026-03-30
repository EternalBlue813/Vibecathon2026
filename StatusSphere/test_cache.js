const axios = require('axios');

async function test() {
    try {
        const result = await axios.get('http://localhost:3000/status');
        console.log("DBS:", JSON.stringify(result.data.dbs, null, 2));
        console.log("OCBC:", JSON.stringify(result.data.ocbc, null, 2));
        console.log("UOB:", JSON.stringify(result.data.uob, null, 2));
    } catch(e) {
        console.error(e.message);
    }
}
test();
