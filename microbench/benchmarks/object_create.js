// Object creation benchmark
// Tests object allocation and array operations

const OBJECT_CREATE_ITERATIONS = 50000;

function runObjectCreate(seed = 0) {
    let objects = [];
    for (let i = 0; i < OBJECT_CREATE_ITERATIONS; i++) {
        objects.push({ id: i + seed, name: 'item' + (seed & 0x3) });
        if (objects.length > 100) {
            objects = [];
        }
    }
    return objects.length;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runObjectCreate, INNER_ITERATIONS: OBJECT_CREATE_ITERATIONS, name: 'objectCreate' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runObjectCreate = runObjectCreate;
    globalThis.OBJECT_CREATE_ITERATIONS = OBJECT_CREATE_ITERATIONS;
}
