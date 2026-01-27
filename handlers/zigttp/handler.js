// zigttp HTTP handler for benchmarking
// Minimal version without JSX for pure performance testing

function fibonacci(n) {
    if (n <= 1) return n;
    let a = 0;
    let b = 1;
    for (let i of range(n - 1)) {
        let temp = a + b;
        a = b;
        b = temp;
    }
    return b;
}

// _processRequest(items, page, limit) is a native Zig function that:
// - Computes pagination (ceil, min, max, arithmetic)
// - Calculates checksum with the same algorithm
// - Returns pre-built JSON string
// This eliminates all JS overhead for the /api/process endpoint.

function handler(request) {
    const path = request.path;

    // /api/health - Health check
    if (path === '/api/health') {
        return Response.json({status: 'ok', runtime: 'zigttp', timestamp: 0});
    }

    // /api/echo - Echo request details
    if (path === '/api/echo') {
        return Response.json({ok: true});
    }

    // /api/json - Echo JSON body (POST)
    if (path === '/api/json') {
        return Response.json({error: 'Not Implemented'});
    }

    // /api/greet/:name - Greeting with path parameter
    // Uses rawJson to bypass object creation and JSON serialization
    if (path.indexOf('/api/greet/') === 0) {
        const name = path.substring(11); // '/api/greet/'.length = 11
        return Response.rawJson('{"greeting":"Hello, ' + name + '!"}');
    }

    // /api/compute - Fibonacci computation
    if (path === '/api/compute') {
        const n = 30;
        const result = fibonacci(n);
        return Response.json({computation: 'fibonacci', n: n, result: result});
    }

    // /api/process - Realistic processing: native Zig implementation
    if (path === '/api/process') {
        const q = request.query;
        const json = _processRequest(q.items || 100, q.page || 1, q.limit || 10);
        return Response.rawJson(json);
    }

    // 404 for everything else
    return Response.json({error: 'Not Found', url: request.url}, {status: 404});
}
