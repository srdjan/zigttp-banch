// Integer arithmetic benchmark
// Tests basic math operations performance

const INNER_ITERATIONS = 50000;

function runArithmetic() {
    let sum = 0;
    for (let i = 0; i < INNER_ITERATIONS; i++) {
        sum = (sum + i) % 1000000;
        sum = (sum - (i % 1000) + 1000000) % 1000000;
        sum = (sum * 2) % 1000000;
        sum = (sum >> 1);
    }
    return sum;
}

// For module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runArithmetic, INNER_ITERATIONS, name: 'arithmetic' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runArithmetic = runArithmetic;
    globalThis.ARITHMETIC_ITERATIONS = INNER_ITERATIONS;
}
