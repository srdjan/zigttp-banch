// Bun HTTP server for benchmarking
// Mirrors Deno handler endpoints

const PORT = parseInt(Bun.env.PORT || "8083", 10);
const NOOP_JSON = '{"ok":true}';
const JSON_HEADERS = { "content-type": "application/json" };

function fibonacci(n: number): number {
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const temp = a + b;
        a = b;
        b = temp;
    }
    return n <= 1 ? n : b;
}

function processRequest(url: URL): object {
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

Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const pathname = url.pathname;
        const method = req.method;

        // /api/noop
        if (pathname === "/api/noop") {
            return new Response(NOOP_JSON, { headers: JSON_HEADERS });
        }

        // /api/health
        if (pathname === "/api/health") {
            return Response.json({
                status: "ok",
                runtime: "bun",
                timestamp: Date.now(),
            });
        }

        // /api/echo
        if (pathname === "/api/echo") {
            const body = await req.text() || null;
            const headers: Record<string, string> = {};
            req.headers.forEach((v, k) => headers[k] = v);
            return Response.json({ method, url: req.url, headers, body });
        }

        // /api/json (POST)
        if (pathname === "/api/json" && method === "POST") {
            const body = await req.text();
            if (!body) {
                return Response.json({ error: "No body provided" }, { status: 400 });
            }
            try {
                const data = JSON.parse(body);
                return Response.json({ received: data, processed: true });
            } catch {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
        }

        // /api/greet/:name
        if (pathname.startsWith("/api/greet/")) {
            const name = decodeURIComponent(pathname.slice("/api/greet/".length));
            return Response.json({ greeting: "Hello, " + name + "!" });
        }

        // /api/compute
        if (pathname === "/api/compute") {
            const n = 30;
            const result = fibonacci(n);
            return Response.json({ computation: "fibonacci", n, result });
        }

        // /api/process
        if (pathname === "/api/process") {
            const result = processRequest(url);
            return Response.json(result);
        }

        // /api/transform (POST)
        if (pathname === "/api/transform" && method === "POST") {
            const body = await req.text();
            if (!body) {
                return Response.json({ error: "No body provided" }, { status: 400 });
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

                return Response.json({
                    stats: { total, count, average: count > 0 ? total / count : 0, highCount, lowCount },
                });
            } catch {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
        }

        // 404
        return Response.json({ error: "Not Found", url: req.url }, { status: 404 });
    },
});

console.log(`Bun server listening on http://127.0.0.1:${PORT}`);
