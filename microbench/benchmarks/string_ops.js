// String operations benchmark
// Tests indexOf and length operations

const INNER_ITERATIONS = 50000;

function runStringOps() {
    const str = 'The quick brown fox jumps over the lazy dog';
    let count = 0;
    for (let i = 0; i < INNER_ITERATIONS; i++) {
        count = (count + str.indexOf('fox')) % 1000000;
        count = (count + str.length) % 1000000;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runStringOps, INNER_ITERATIONS, name: 'stringOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runStringOps = runStringOps;
    globalThis.STRING_OPS_ITERATIONS = INNER_ITERATIONS;
}
