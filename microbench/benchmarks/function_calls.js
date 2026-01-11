// Function call overhead benchmark
// Tests nested function call performance

const FUNCTION_CALLS_ITERATIONS = 50000;

function add(a, b) {
    return (a + b) % 1000000;
}

function compute(x, y) {
    return add(x, y);
}

function runFunctionCalls(seed = 0) {
    let result = seed | 0;
    for (let i = 0; i < FUNCTION_CALLS_ITERATIONS; i++) {
        result = compute((i + seed) % 1000, result);
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runFunctionCalls, INNER_ITERATIONS: FUNCTION_CALLS_ITERATIONS, name: 'functionCalls' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runFunctionCalls = runFunctionCalls;
    globalThis.FUNCTION_CALLS_ITERATIONS = FUNCTION_CALLS_ITERATIONS;
}
