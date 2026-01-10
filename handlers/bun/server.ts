// Bun HTTP server for benchmarking
// Mirrors zigttp handler.jsx endpoints

const PORT = parseInt(process.env.PORT || "8080", 10);

function fibonacci(n: number): number {
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const temp = a + b;
        a = b;
        b = temp;
    }
    return n <= 1 ? n : b;
}

Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const pathname = url.pathname;
        const method = req.method;

        // /api/health - Health check
        if (pathname === "/api/health") {
            return Response.json({
                status: "ok",
                runtime: "bun",
                timestamp: Date.now()
            });
        }

        // /api/echo - Echo request details
        if (pathname === "/api/echo") {
            const body = await req.text() || null;
            const headers: Record<string, string> = {};
            req.headers.forEach((v, k) => headers[k] = v);
            return Response.json({
                method: method,
                url: req.url,
                headers: headers,
                body: body
            });
        }

        // /api/json - Echo JSON body (POST)
        if (pathname === "/api/json" && method === "POST") {
            const body = await req.text();
            if (!body) {
                return Response.json({ error: "No body provided" }, { status: 400 });
            }
            try {
                const data = JSON.parse(body);
                return Response.json({
                    received: data,
                    processed: true
                });
            } catch {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
        }

        // /api/greet/:name - Greeting with path parameter
        if (pathname.startsWith("/api/greet/")) {
            const name = decodeURIComponent(pathname.slice("/api/greet/".length));
            return Response.json({
                greeting: "Hello, " + name + "!"
            });
        }

        // /api/compute - Fibonacci computation
        if (pathname === "/api/compute") {
            const n = 30;
            const result = fibonacci(n);
            return Response.json({
                computation: "fibonacci",
                n: n,
                result: result
            });
        }

        // 404 for everything else
        return Response.json({ error: "Not Found", url: req.url }, { status: 404 });
    }
});

console.log(`Bun server listening on http://127.0.0.1:${PORT}`);
