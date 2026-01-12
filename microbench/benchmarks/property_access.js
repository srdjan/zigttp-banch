// Property access benchmark
// Tests object property read/write performance

const PROPERTY_ACCESS_ITERATIONS = 50000;

function runPropertyAccess(seed = 0) {
    const obj = { a: seed & 0xff, b: 2, c: 3, d: 4, e: 5 };
    let sum = 0;
    for (let i of range(PROPERTY_ACCESS_ITERATIONS)) {
        sum = (sum + obj.a + obj.b + obj.c + obj.d + obj.e) % 1000000;
        obj.a = (i + seed) % 100;
    }
    return sum;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runPropertyAccess, INNER_ITERATIONS: PROPERTY_ACCESS_ITERATIONS, name: 'propertyAccess' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runPropertyAccess = runPropertyAccess;
    globalThis.PROPERTY_ACCESS_ITERATIONS = PROPERTY_ACCESS_ITERATIONS;
}
