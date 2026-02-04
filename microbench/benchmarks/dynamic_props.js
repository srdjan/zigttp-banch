// Dynamic property access benchmark
// Tests obj.prop patterns - zigttp does not support bracket notation on objects
// zigttp compatibility: Reduced from 10 to 4 properties (long if-else chains crash)

const DYNAMIC_PROPS_ITERATIONS = 20000;

function runDynamicProps(seed) {
    if (seed === undefined) seed = 0;
    // Use direct property access since zigttp doesn't support obj[key]
    const obj = { p0: 1, p1: 2, p2: 3, p3: 4 };
    let sum = 0;

    for (let iter of range(DYNAMIC_PROPS_ITERATIONS)) {
        // Direct property reads in sequence (simulates dynamic access pattern)
        const idx = (iter + seed) % 4;

        // Read all properties in rotation based on idx
        if (idx === 0) {
            sum = (sum + obj.p0 + obj.p1) % 1000000;
            obj.p0 = (obj.p0 + 1) % 100;
        } else if (idx === 1) {
            sum = (sum + obj.p1 + obj.p2) % 1000000;
            obj.p1 = (obj.p1 + 1) % 100;
        } else if (idx === 2) {
            sum = (sum + obj.p2 + obj.p3) % 1000000;
            obj.p2 = (obj.p2 + 1) % 100;
        } else {
            sum = (sum + obj.p3 + obj.p0) % 1000000;
            obj.p3 = (obj.p3 + 1) % 100;
        }
    }
    return sum;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runDynamicProps, INNER_ITERATIONS: DYNAMIC_PROPS_ITERATIONS, name: 'dynamicProps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runDynamicProps = runDynamicProps;
    globalThis.DYNAMIC_PROPS_ITERATIONS = DYNAMIC_PROPS_ITERATIONS;
}
