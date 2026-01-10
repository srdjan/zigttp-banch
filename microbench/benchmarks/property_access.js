// Property access benchmark
// Tests object property read/write performance

const INNER_ITERATIONS = 50000;

function runPropertyAccess() {
    const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    let sum = 0;
    for (let i = 0; i < INNER_ITERATIONS; i++) {
        sum = (sum + obj.a + obj.b + obj.c + obj.d + obj.e) % 1000000;
        obj.a = i % 100;
    }
    return sum;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runPropertyAccess, INNER_ITERATIONS, name: 'propertyAccess' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runPropertyAccess = runPropertyAccess;
    globalThis.PROPERTY_ACCESS_ITERATIONS = INNER_ITERATIONS;
}
