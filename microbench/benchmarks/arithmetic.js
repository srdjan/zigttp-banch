// Integer arithmetic benchmark
// Tests basic math operations performance

const ARITHMETIC_ITERATIONS = 20000;

function runArithmetic(seed = 0) {
    let sum = seed | 0;
    for (let i of range(ARITHMETIC_ITERATIONS)) {
        sum = (sum + i + seed) % 1000000;
        sum = (sum - ((i + seed) % 1000) + 1000000) % 1000000;
        sum = (sum * 2 + seed) % 1000000;
        sum = (sum >> 1);
    }
    return sum;
}

// For module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runArithmetic, INNER_ITERATIONS: ARITHMETIC_ITERATIONS, name: 'arithmetic' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runArithmetic = runArithmetic;
    globalThis.ARITHMETIC_ITERATIONS = ARITHMETIC_ITERATIONS;
}
