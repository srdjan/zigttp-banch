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

function handler(request) {
    const path = request.path;

    // /api/health - Health check
    if (path === '/api/health') {
        return Response.text('{"status":"ok","runtime":"zigttp","timestamp":0}');
    }

    // /api/echo - Echo request details
    if (path === '/api/echo') {
        return Response.text('{"ok":true}');
    }

    // /api/json - Echo JSON body (POST)
    if (path === '/api/json') {
        return Response.text('{"error":"Not Implemented"}');
    }

    // /api/greet/:name - Greeting with path parameter
    if (path.indexOf('/api/greet/') === 0) {
        const name = path.substring('/api/greet/'.length);
        return Response.text('{"greeting":"Hello, ' + name + '!"}');
    }

    // /api/compute - Fibonacci computation
    if (path === '/api/compute') {
        const n = 30;
        const result = fibonacci(n);
        return Response.text('{"computation":"fibonacci","n":' + n + ',"result":' + result + '}');
    }

    // 404 for everything else
    return Response.text('{"error":"Not Found","url":"' + path + '"}');
}
