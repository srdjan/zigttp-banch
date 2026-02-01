// Object creation benchmark
// Tests object allocation patterns
// zigttp compatibility: Pre-computed strings (concatenation crashes in tight loops)

const OBJECT_CREATE_ITERATIONS = 20000;

function runObjectCreate(seed) {
    if (seed === undefined) seed = 0;
    let count = 0;
    let lastObj = null;

    // Pre-compute name values to avoid string concat during benchmark
    const names = ['item0', 'item1', 'item2', 'item3'];

    for (let i of range(OBJECT_CREATE_ITERATIONS)) {
        // Create new object each iteration
        const obj = { id: i + seed, name: names[seed % 4], value: i * 2 };

        // Access properties to ensure object is actually used
        count = (count + obj.id + obj.value) % 1000000;

        // Create nested objects periodically
        if ((i % 10) === 0) {
            const nested = { parent: lastObj, data: { x: i, y: seed } };
            count = (count + nested.data.x) % 1000000;
        }

        lastObj = obj;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runObjectCreate, INNER_ITERATIONS: OBJECT_CREATE_ITERATIONS, name: 'objectCreate' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runObjectCreate = runObjectCreate;
    globalThis.OBJECT_CREATE_ITERATIONS = OBJECT_CREATE_ITERATIONS;
}
