// JSON operations benchmark
// Tests JSON.stringify and JSON.parse performance

const INNER_ITERATIONS = 5000;

function runJsonOps() {
    const obj = { users: [{ id: 1 }, { id: 2 }] };
    let count = 0;
    for (let i = 0; i < INNER_ITERATIONS; i++) {
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        count = (count + parsed.users.length) % 1000000;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runJsonOps, INNER_ITERATIONS, name: 'jsonOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runJsonOps = runJsonOps;
    globalThis.JSON_OPS_ITERATIONS = INNER_ITERATIONS;
}
