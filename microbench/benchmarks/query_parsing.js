// Query parameter parsing benchmark
// Tests parseInt, Math functions, and string operations - common FaaS operations

const QUERY_PARSING_ITERATIONS = 10000;

function runQueryParsing(seed = 0) {
    let result = 0;

    // Simulate various query strings
    const queries = [
        'page=1&limit=10&offset=0',
        'page=5&limit=25&offset=100',
        'page=12&limit=50&offset=550',
        'id=42&count=7&max=999'
    ];

    for (let i of range(QUERY_PARSING_ITERATIONS)) {
        const queryStr = queries[(i + seed) % 4];

        // Pattern 1: Parse common pagination params using indexOf with start position
        let page = 1;
        let limit = 10;
        let offset = 0;

        // Parse page
        const pageIdx = queryStr.indexOf('page=');
        if (pageIdx !== -1) {
            const ampIdx = queryStr.indexOf('&', pageIdx + 5);
            const valStr = ampIdx === -1
                ? queryStr.slice(pageIdx + 5)
                : queryStr.slice(pageIdx + 5, ampIdx);
            page = parseInt(valStr, 10);
        }

        // Parse limit
        const limitIdx = queryStr.indexOf('limit=');
        if (limitIdx !== -1) {
            const ampIdx = queryStr.indexOf('&', limitIdx + 6);
            const valStr = ampIdx === -1
                ? queryStr.slice(limitIdx + 6)
                : queryStr.slice(limitIdx + 6, ampIdx);
            limit = parseInt(valStr, 10);
        }

        // Parse offset
        const offsetIdx = queryStr.indexOf('offset=');
        if (offsetIdx !== -1) {
            const ampIdx = queryStr.indexOf('&', offsetIdx + 7);
            const valStr = ampIdx === -1
                ? queryStr.slice(offsetIdx + 7)
                : queryStr.slice(offsetIdx + 7, ampIdx);
            offset = parseInt(valStr, 10);
        }

        // Pattern 2: Math operations (pagination calculations)
        const totalItems = 1000 + (seed & 0xff);
        const totalPages = Math.ceil(totalItems / limit);
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const startIdx = Math.floor((currentPage - 1) * limit);
        const endIdx = Math.min(startIdx + limit, totalItems);

        // Pattern 3: Bounds validation
        const clampedOffset = Math.max(0, Math.min(offset, totalItems - 1));
        const remaining = Math.abs(totalItems - clampedOffset);

        result = (result + page + limit + offset + totalPages + startIdx + endIdx + remaining) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runQueryParsing, INNER_ITERATIONS: QUERY_PARSING_ITERATIONS, name: 'queryParsing' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runQueryParsing = runQueryParsing;
    globalThis.QUERY_PARSING_ITERATIONS = QUERY_PARSING_ITERATIONS;
}
