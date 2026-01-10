// Node.js HTTP server for benchmarking
// Mirrors zigttp handler.jsx endpoints

const http = require('http');

const PORT = parseInt(process.env.PORT || '8080', 10);

function collectBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks).toString() : null));
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    const method = req.method;

    res.setHeader('Content-Type', 'application/json');

    // /api/health - Health check
    if (pathname === '/api/health') {
        res.end(JSON.stringify({
            status: 'ok',
            runtime: 'node',
            timestamp: Date.now()
        }));
        return;
    }

    // /api/echo - Echo request details
    if (pathname === '/api/echo') {
        const body = await collectBody(req);
        res.end(JSON.stringify({
            method: method,
            url: req.url,
            headers: req.headers,
            body: body
        }));
        return;
    }

    // /api/json - Echo JSON body (POST)
    if (pathname === '/api/json' && method === 'POST') {
        const body = await collectBody(req);
        if (!body) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'No body provided' }));
            return;
        }
        try {
            const data = JSON.parse(body);
            res.end(JSON.stringify({
                received: data,
                processed: true
            }));
        } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
        return;
    }

    // /api/greet/:name - Greeting with path parameter
    if (pathname.startsWith('/api/greet/')) {
        const name = decodeURIComponent(pathname.slice('/api/greet/'.length));
        res.end(JSON.stringify({
            greeting: 'Hello, ' + name + '!'
        }));
        return;
    }

    // /api/compute - Fibonacci computation
    if (pathname === '/api/compute') {
        const n = 30;
        let a = 0, b = 1;
        for (let i = 2; i <= n; i++) {
            const temp = a + b;
            a = b;
            b = temp;
        }
        res.end(JSON.stringify({
            computation: 'fibonacci',
            n: n,
            result: b
        }));
        return;
    }

    // 404 for everything else
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found', url: req.url }));
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Node server listening on http://127.0.0.1:${PORT}`);
});
