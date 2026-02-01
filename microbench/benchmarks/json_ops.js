// JSON operations benchmark
// Tests JSON.stringify and JSON.parse performance

const JSON_OPS_ITERATIONS = 5000;

function runJsonOps(seed = 0) {
    const obj = { users: [{ id: 1 }, { id: 2 }], seed: 0 };
    obj.seed = seed;
    obj.users[0].id = (seed & 0xff) + 1;
    obj.users[1].id = (seed & 0xff) + 2;
    let count = 0;
    for (let _ of range(JSON_OPS_ITERATIONS)) {
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        count = (count + parsed.users.length) % 1000000;
    }
    return count;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runJsonOps = runJsonOps;
    globalThis.JSON_OPS_ITERATIONS = JSON_OPS_ITERATIONS;
}
