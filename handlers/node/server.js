// Node.js HTTP server for benchmarking
// Mirrors Deno handler endpoints

const http = require("node:http");

const PORT = parseInt(process.env.PORT || "8082", 10);
const NOOP_BODY = '{"ok":true}';
const JSON_HEADERS = { "content-type": "application/json" };

function fibonacci(n) {
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const temp = a + b;
        a = b;
        b = temp;
    }
    return n <= 1 ? n : b;
}

function processRequest(url) {
    const totalItems = parseInt(url.searchParams.get("items") || "100", 10);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    const totalPages = Math.ceil(totalItems / limit);
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const startIdx = (currentPage - 1) * limit;
    const endIdx = Math.min(startIdx + limit, totalItems);
    const itemCount = endIdx - startIdx;

    let checksum = 0;
    for (let i = 0; i < itemCount; i++) {
        const itemIdx = startIdx + i;
        const val = ((itemIdx * 31) ^ (itemIdx * 17)) % 10000;
        checksum = (checksum + val) % 1000000;
    }

    return { page: currentPage, pages: totalPages, count: itemCount, checksum };
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    });
}

function sendJson(res, data, status) {
    const body = JSON.stringify(data);
    res.writeHead(status || 200, JSON_HEADERS);
    res.end(body);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;
    const method = req.method;

    // /api/noop
    if (pathname === "/api/noop") {
        res.writeHead(200, JSON_HEADERS);
        res.end(NOOP_BODY);
        return;
    }

    // /api/health
    if (pathname === "/api/health") {
        sendJson(res, { status: "ok", runtime: "node", timestamp: Date.now() });
        return;
    }

    // /api/echo
    if (pathname === "/api/echo") {
        const body = await readBody(req);
        const headers = {};
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            headers[req.rawHeaders[i].toLowerCase()] = req.rawHeaders[i + 1];
        }
        sendJson(res, {
            method,
            url: req.url,
            headers,
            body: body || null,
        });
        return;
    }

    // /api/json (POST)
    if (pathname === "/api/json" && method === "POST") {
        const body = await readBody(req);
        if (!body) {
            sendJson(res, { error: "No body provided" }, 400);
            return;
        }
        try {
            const data = JSON.parse(body);
            sendJson(res, { received: data, processed: true });
        } catch {
            sendJson(res, { error: "Invalid JSON" }, 400);
        }
        return;
    }

    // /api/greet/:name
    if (pathname.startsWith("/api/greet/")) {
        const name = decodeURIComponent(pathname.slice("/api/greet/".length));
        sendJson(res, { greeting: "Hello, " + name + "!" });
        return;
    }

    // /api/compute
    if (pathname === "/api/compute") {
        const n = 30;
        const result = fibonacci(n);
        sendJson(res, { computation: "fibonacci", n, result });
        return;
    }

    // /api/process
    if (pathname === "/api/process") {
        const result = processRequest(url);
        sendJson(res, result);
        return;
    }

    // /api/transform (POST)
    if (pathname === "/api/transform" && method === "POST") {
        const body = await readBody(req);
        if (!body) {
            sendJson(res, { error: "No body provided" }, 400);
            return;
        }
        try {
            const data = JSON.parse(body);
            const items = data.items || [];

            let total = 0;
            let count = 0;
            let highCount = 0;
            let lowCount = 0;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const value = item.value || 0;
                const active = item.active !== false;

                if (active && value > 0) {
                    total = total + value;
                    count = count + 1;
                    if (value > 50) {
                        highCount = highCount + 1;
                    } else {
                        lowCount = lowCount + 1;
                    }
                }
            }

            sendJson(res, {
                stats: {
                    total,
                    count,
                    average: count > 0 ? total / count : 0,
                    highCount,
                    lowCount,
                },
            });
        } catch {
            sendJson(res, { error: "Invalid JSON" }, 400);
        }
        return;
    }

    // 404
    sendJson(res, { error: "Not Found", url: req.url }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`Node server listening on http://127.0.0.1:${PORT}`);
});
