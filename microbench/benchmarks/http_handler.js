// HTTP handler simulation benchmark
// Tests object creation + JSON stringify like a typical response

const HTTP_HANDLER_ITERATIONS = 5000;

function runHttpHandler(seed = 0) {
    let responses = 0;
    for (let i of range(HTTP_HANDLER_ITERATIONS)) {
        const response = {
            status: 200,
            body: JSON.stringify({ id: (i + seed) % 100, name: 'User' + (seed & 7) })
        };
        responses = (responses + response.body.length) % 1000000;
    }
    return responses;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runHttpHandler, INNER_ITERATIONS: HTTP_HANDLER_ITERATIONS, name: 'httpHandler' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runHttpHandler = runHttpHandler;
    globalThis.HTTP_HANDLER_ITERATIONS = HTTP_HANDLER_ITERATIONS;
}
