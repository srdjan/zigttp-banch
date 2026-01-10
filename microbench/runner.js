// Universal microbenchmark runner
// Works in Node.js, Deno, Bun, and zigttp

const WARMUP_ITERATIONS = 10;
const MEASURED_ITERATIONS = 30;

// Get high-resolution time in milliseconds
function now() {
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    if (typeof Date !== 'undefined') {
        return Date.now();
    }
    return 0;
}

// Run a single benchmark
function benchmark(name, fn, innerIterations) {
    const results = [];

    // Warmup phase
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        fn();
    }

    // Measured phase
    for (let i = 0; i < MEASURED_ITERATIONS; i++) {
        const start = now();
        fn();
        const elapsed = now() - start;
        results.push(elapsed);
    }

    // Calculate statistics
    const totalMs = results.reduce((a, b) => a + b, 0);
    const meanMs = totalMs / results.length;
    const totalOps = innerIterations * MEASURED_ITERATIONS;
    const nsPerOp = (totalMs * 1_000_000) / totalOps;
    const opsPerSec = Math.floor(totalOps / (totalMs / 1000));

    return {
        name: name,
        warmup_iterations: WARMUP_ITERATIONS,
        measured_iterations: MEASURED_ITERATIONS,
        inner_iterations: innerIterations,
        total_ms: totalMs,
        mean_ms: meanMs,
        ns_per_op: nsPerOp,
        ops_per_sec: opsPerSec
    };
}

// Detect runtime
function detectRuntime() {
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof Deno !== 'undefined') return 'deno';
    if (typeof process !== 'undefined' && process.versions && process.versions.node) return 'node';
    if (typeof Response !== 'undefined' && typeof Response.json === 'function') return 'zigttp';
    return 'unknown';
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { benchmark, detectRuntime, WARMUP_ITERATIONS, MEASURED_ITERATIONS };
}
if (typeof globalThis !== 'undefined') {
    globalThis.benchmark = benchmark;
    globalThis.detectRuntime = detectRuntime;
}
