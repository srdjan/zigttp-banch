// Math operations benchmark
// Tests Math.floor/ceil/min/max/abs - common for pagination and bounds

const MATH_OPS_ITERATIONS = 20000;

function runMathOps(seed = 0) {
    let result = 0;

    for (let i of range(MATH_OPS_ITERATIONS)) {
        const x = (i + seed) % 1000 + 0.5;
        const y = ((i * 7) + seed) % 500;
        const z = ((i * 13) + seed) % 2000;

        // Common pagination math patterns
        const floored = Math.floor(x);
        const ceiled = Math.ceil(x);
        const rounded = Math.round(x);
        const minVal = Math.min(y, z);
        const maxVal = Math.max(y, z);
        const absVal = Math.abs(y - z);

        // Nested operations (common for bounds clamping)
        const clamped = Math.max(0, Math.min(100, floored));

        result = (result + floored + ceiled + rounded + minVal + maxVal + absVal + clamped) % 1000000;
    }
    return result;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runMathOps = runMathOps;
    globalThis.MATH_OPS_ITERATIONS = MATH_OPS_ITERATIONS;
}
