// zigttp HTTP handler for benchmarking
// Minimal version without JSX for pure performance testing

function fibonacci(n) {
    if (n <= 1) return n;
    let a = 0;
    let b = 1;
    for (let i of range(2, n + 1)) {
        let temp = a + b;
        a = b;
        b = temp;
    }
    return b;
}

function handler(request) {
    const url = request.url;
    const method = request.method;

    // /api/health - Health check
    if (url === '/api/health') {
        return Response.json({
            status: 'ok',
            runtime: 'zigttp',
            timestamp: Date.now()
        });
    }

    // /api/echo - Echo request details
    if (url === '/api/echo') {
        return Response.json({
            method: method,
            url: url,
            headers: request.headers,
            body: request.body
        });
    }

    // /api/json - Echo JSON body (POST)
    if (url === '/api/json' && method === 'POST') {
        const body = request.body;
        if (!body) {
            return Response.json({ error: 'No body provided' }, { status: 400 });
        }
        const result = JSON.tryParse(body);
        if (result.isErr()) {
            return Response.json({ error: result.unwrapErr() }, { status: 400 });
        }
        return Response.json({
            received: result.unwrap(),
            processed: true
        });
    }

    // /api/greet/:name - Greeting with path parameter
    if (url.indexOf('/api/greet/') === 0) {
        const name = url.substring('/api/greet/'.length);
        return Response.json({
            greeting: 'Hello, ' + name + '!'
        });
    }

    // /api/compute - Fibonacci computation
    if (url === '/api/compute') {
        const n = 30;
        const result = fibonacci(n);
        return Response.json({
            computation: 'fibonacci',
            n: n,
            result: result
        });
    }

    // 404 for everything else
    return Response.json({ error: 'Not Found', url: url }, { status: 404 });
}
