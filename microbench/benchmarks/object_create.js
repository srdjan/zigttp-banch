// Object creation benchmark
// Tests object allocation and array operations

const INNER_ITERATIONS = 50000;

function runObjectCreate() {
    let objects = [];
    for (let i = 0; i < INNER_ITERATIONS; i++) {
        objects.push({ id: i, name: 'item' });
        if (objects.length > 100) {
            objects = [];
        }
    }
    return objects.length;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runObjectCreate, INNER_ITERATIONS, name: 'objectCreate' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runObjectCreate = runObjectCreate;
    globalThis.OBJECT_CREATE_ITERATIONS = INNER_ITERATIONS;
}
