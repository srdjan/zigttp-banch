// Function call overhead benchmark
// Tests nested function call performance

const INNER_ITERATIONS = 50000;

function add(a, b) {
    return (a + b) % 1000000;
}

function compute(x, y) {
    return add(x, y);
}

function runFunctionCalls() {
    let result = 0;
    for (let i = 0; i < INNER_ITERATIONS; i++) {
        result = compute(i % 1000, result);
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runFunctionCalls, INNER_ITERATIONS, name: 'functionCalls' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runFunctionCalls = runFunctionCalls;
    globalThis.FUNCTION_CALLS_ITERATIONS = INNER_ITERATIONS;
}
