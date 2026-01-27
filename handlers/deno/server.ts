// Deno HTTP server for benchmarking
// Mirrors zigttp handler.jsx endpoints

const PORT = parseInt(Deno.env.get("PORT") || "8080", 10);

function fibonacci(n: number): number {
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
        const temp = a + b;
        a = b;
        b = temp;
    }
    return n <= 1 ? n : b;
}

// Realistic processing: query parsing, pagination, data transformation
function processRequest(url: URL): object {
    const totalItems = parseInt(url.searchParams.get("items") || "100", 10);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    // Pagination math
    const totalPages = Math.ceil(totalItems / limit);
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const startIdx = (currentPage - 1) * limit;
    const endIdx = Math.min(startIdx + limit, totalItems);
    const itemCount = endIdx - startIdx;

    // Generate mock items with computation
    let checksum = 0;
    for (let i = 0; i < itemCount; i++) {
        const itemIdx = startIdx + i;
        // Simulate data transformation: hash-like computation
        const val = ((itemIdx * 31) ^ (itemIdx * 17)) % 10000;
        checksum = (checksum + val) % 1000000;
    }

    // Simplified response structure for zigttp compatibility
    return {
        page: currentPage,
        pages: totalPages,
        count: itemCount,
        checksum: checksum,
    };
}

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method;

    // /api/health - Health check
    if (pathname === "/api/health") {
        return Response.json({
            status: "ok",
            runtime: "deno",
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

    // /api/process - Realistic processing: query parsing, pagination, data transform
    if (pathname === "/api/process") {
        const result = processRequest(url);
        return Response.json(result);
    }

    // 404 for everything else
    return Response.json({ error: "Not Found", url: req.url }, { status: 404 });
});

console.log(`Deno server listening on http://127.0.0.1:${PORT}`);
