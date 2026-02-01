// HTTP handler simulation (heavy)
// Exercises routing, JSON parse, object mutation, and response assembly

const DEFAULT_HTTP_HANDLER_HEAVY_ITERATIONS = 2000;
let HTTP_HANDLER_HEAVY_ITERATIONS = DEFAULT_HTTP_HANDLER_HEAVY_ITERATIONS;
if (typeof __httpHandlerHeavyIterations !== 'undefined' && __httpHandlerHeavyIterations) {
    const override = __httpHandlerHeavyIterations;
    if (override > 0) {
        HTTP_HANDLER_HEAVY_ITERATIONS = override;
    }
}

function runHttpHandlerHeavy(seed = 0) {
    let responses = 0;
    const baseHeaders = {
        contentType: 'application/json',
        cacheControl: 'no-store'
    };
    const payload = JSON.stringify({
        id: seed & 0xff,
        name: 'User' + (seed & 7),
        tags: ['alpha', 'beta', 'gamma']
    });

    for (let i of range(HTTP_HANDLER_HEAVY_ITERATIONS)) {
        const reqPath = (i + seed) % 3 === 0 ? '/api/users' : '/api/users/42';
        const query = (i + seed) % 2 === 0 ? '?limit=10&offset=5' : '?limit=25&offset=0';

        let limit = 10;
        let offset = 0;
        if (query.indexOf('limit=25') !== -1) {
            limit = 25;
        }
        if (query.indexOf('offset=5') !== -1) {
            offset = 5;
        }

        let bodyObj = null;
        if (reqPath.indexOf('/api/users') === 0) {
            bodyObj = JSON.parse(payload);
            bodyObj.limit = limit;
            bodyObj.offset = offset;
        }

        const headers = {
            contentType: baseHeaders.contentType,
            cacheControl: baseHeaders.cacheControl,
            xRequestId: 'req-' + ((i + seed) % 1000)
        };

        const response = {
            status: reqPath === '/api/users' ? 200 : 201,
            headers: headers,
            body: JSON.stringify({
                ok: true,
                path: reqPath,
                data: bodyObj
            })
        };

        responses = (responses + response.body.length + response.status) % 1000000;
    }

    return responses;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runHttpHandlerHeavy = runHttpHandlerHeavy;
    globalThis.HTTP_HANDLER_HEAVY_ITERATIONS = HTTP_HANDLER_HEAVY_ITERATIONS;
}
