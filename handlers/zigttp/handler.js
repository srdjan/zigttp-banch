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

// Manual ceil for zigttp (avoids Math.ceil issues)
function ceil(x) {
    const floor = (x | 0);
    return x > floor ? floor + 1 : floor;
}

// Manual min/max for zigttp
function min(a, b) {
    return a < b ? a : b;
}

function max(a, b) {
    return a > b ? a : b;
}

// Realistic processing: query parsing, pagination, data transformation
// Query parameters are pre-parsed to integers by the native Zig layer
// Note: All numeric operations must be coerced with | 0 for zigttp compatibility
function processRequest(query) {
    // Query params are already integers from native parsing, just provide defaults
    const totalItems = (query.items || 100) | 0;
    const page = (query.page || 1) | 0;
    const limit = (query.limit || 10) | 0;

    // Pagination math (coerce all results)
    const totalPages = ceil(totalItems / limit) | 0;
    const currentPage = (min(max(1, page), totalPages)) | 0;
    const startIdx = ((currentPage - 1) * limit) | 0;
    const endIdx = (min(startIdx + limit, totalItems)) | 0;
    const itemCount = (endIdx - startIdx) | 0;

    // Generate mock items with computation
    let checksum = 0;
    for (let i of range(itemCount)) {
        const itemIdx = (startIdx + i) | 0;
        // Simulate data transformation: hash-like computation
        const val = (((itemIdx * 31) ^ (itemIdx * 17)) % 10000) | 0;
        checksum = ((checksum + val) % 1000000) | 0;
    }

    // Build JSON response - simpler structure for zigttp compatibility
    return '{"page":' + currentPage + ',"pages":' + totalPages + ',"count":' + itemCount + ',"checksum":' + checksum + '}';
}

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

    // /api/process - Realistic processing: uses native query object
    if (path === '/api/process') {
        const json = processRequest(request.query);
        return Response.rawJson(json);
    }

    // 404 for everything else
    return Response.json({error: 'Not Found', url: request.url}, {status: 404});
}
