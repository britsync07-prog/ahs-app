const http = require('http');

async function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: 8081,
            path: path,
            method: method,
            headers: headers
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function runTests() {
    try {
        console.log("Starting Deep WebDAV Test...");

        // 1. Upload a file
        console.log("1. Uploading 'test-deep.txt'...");
        let res = await request('PUT', '/test-deep.txt', 'Hello Secure Vault!');
        console.log("   Upload Status:", res.status);
        if (res.status !== 201) throw new Error("Upload failed");

        // 2. Read the file
        console.log("2. Reading 'test-deep.txt'...");
        res = await request('GET', '/test-deep.txt');
        console.log("   Content:", res.data);
        if (res.data !== 'Hello Secure Vault!') throw new Error("Read content mismatch");

        // 3. Edit/Overwrite the file
        console.log("3. Editing 'test-deep.txt'...");
        res = await request('PUT', '/test-deep.txt', 'Updated Content Here');
        console.log("   Edit Status:", res.status);
        
        res = await request('GET', '/test-deep.txt');
        console.log("   New Content:", res.data);
        if (res.data !== 'Updated Content Here') throw new Error("Edit content mismatch");

        // 4. Rename the file
        console.log("4. Renaming to 'test-renamed.txt'...");
        res = await request('MOVE', '/test-deep.txt', null, { 'Destination': 'http://127.0.0.1:8081/test-renamed.txt' });
        console.log("   Rename Status:", res.status);

        res = await request('GET', '/test-renamed.txt');
        console.log("   Renamed Content:", res.data);
        if (res.data !== 'Updated Content Here') throw new Error("Rename content mismatch");

        // 5. Delete the file
        console.log("5. Deleting 'test-renamed.txt'...");
        res = await request('DELETE', '/test-renamed.txt');
        console.log("   Delete Status:", res.status);

        res = await request('GET', '/test-renamed.txt');
        console.log("   Status after delete:", res.status);
        if (res.status !== 404) throw new Error("File still exists after delete");

        console.log("✅ All WebDAV deep tests passed successfully!");
    } catch (err) {
        console.error("❌ Test failed:", err.message);
        process.exit(1);
    }
}

runTests();