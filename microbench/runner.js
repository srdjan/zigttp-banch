// Universal microbenchmark runner
// Works in Node.js, Deno, Bun, and zigttp

const WARMUP_ITERATIONS = 20;
const MEASURED_ITERATIONS = 30;
const MIN_WARMUP_MS = 100;
const MIN_TARGET_SAMPLE_MS = 20;
const MAX_TARGET_SAMPLE_MS = 100;
const MAX_BATCH_SIZE = 1_000_000;

const benchState = { seed: 1, sink: 0 };
if (typeof globalThis !== 'undefined') {
    globalThis.__benchState = benchState;
}

function toMsFromNs(value) {
    if (typeof value === 'bigint') {
        return Number(value) / 1_000_000;
    }
    return value / 1_000_000;
}

function getClock() {
    if (typeof Bun !== 'undefined' && typeof Bun.nanoseconds === 'function') {
        return { now: () => toMsFromNs(Bun.nanoseconds()), source: 'Bun.nanoseconds' };
    }
    if (typeof process !== 'undefined' && process.hrtime && typeof process.hrtime.bigint === 'function') {
        return { now: () => toMsFromNs(process.hrtime.bigint()), source: 'process.hrtime.bigint' };
    }
    if (typeof performance !== 'undefined' && performance.now) {
        return { now: () => performance.now(), source: 'performance.now' };
    }
    if (typeof Date !== 'undefined') {
        return { now: () => Date.now(), source: 'Date.now' };
    }
    return { now: () => 0, source: 'none' };
}

function estimateResolutionMs(now) {
    let last = now();
    let minDelta = Infinity;
    for (let i = 0; i < 1000; i++) {
        const current = now();
        const delta = current - last;
        if (delta > 0 && delta < minDelta) {
            minDelta = delta;
        }
        last = current;
    }
    return minDelta === Infinity ? 1 : minDelta;
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[idx];
}

function consume(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        benchState.sink = (benchState.sink + value) | 0;
    } else if (typeof value === 'string') {
        benchState.sink = (benchState.sink + value.length) | 0;
    } else if (value && typeof value === 'object') {
        benchState.sink = (benchState.sink + 1) | 0;
    }
}

function runBatch(fn, batchSize) {
    let seed = benchState.seed;
    for (let i = 0; i < batchSize; i++) {
        const result = fn(seed);
        consume(result);
        seed = (seed + 1) | 0;
    }
    benchState.seed = seed;
}

function calibrateBatch(fn, now, targetSampleMs) {
    let batchSize = 1;
    let elapsed = 0;

    for (let i = 0; i < 20; i++) {
        const start = now();
        runBatch(fn, batchSize);
        elapsed = now() - start;
        if (elapsed >= targetSampleMs) break;

        if (elapsed <= 0) {
            batchSize = Math.min(MAX_BATCH_SIZE, batchSize * 10);
        } else {
            const scale = targetSampleMs / elapsed;
            batchSize = Math.min(MAX_BATCH_SIZE, Math.max(batchSize + 1, Math.ceil(batchSize * scale)));
        }
    }

    return { batchSize, elapsed };
}

// Run a single benchmark
function benchmark(name, fn, innerIterations, options = {}) {
    const clock = getClock();
    const now = clock.now;
    const resolutionMs = estimateResolutionMs(now);
    const targetSampleMs = Math.min(
        MAX_TARGET_SAMPLE_MS,
        Math.max(MIN_TARGET_SAMPLE_MS, resolutionMs * 50)
    );

    const warmupIterations = options.warmupIterations ?? WARMUP_ITERATIONS;
    const measuredIterations = options.measuredIterations ?? MEASURED_ITERATIONS;
    const warmupMs = options.warmupMs ?? Math.max(MIN_WARMUP_MS, targetSampleMs);

    // Warmup phase (iterations + time-based)
    for (let i = 0; i < warmupIterations; i++) {
        runBatch(fn, 1);
    }
    const warmupStart = now();
    while ((now() - warmupStart) < warmupMs) {
        runBatch(fn, 1);
    }

    // Calibrate batch size to get stable samples
    const calibration = calibrateBatch(fn, now, targetSampleMs);
    const batchSize = calibration.batchSize;

    // Measured phase
    const results = [];
    for (let i = 0; i < measuredIterations; i++) {
        const start = now();
        runBatch(fn, batchSize);
        const elapsed = now() - start;
        results.push(elapsed);
    }

    // Calculate statistics
    const totalMs = results.reduce((a, b) => a + b, 0);
    const meanMs = totalMs / results.length;
    const sorted = results.slice().sort((a, b) => a - b);
    const medianMs = percentile(sorted, 0.5);
    const p95Ms = percentile(sorted, 0.95);
    const minMs = sorted[0] ?? 0;
    const maxMs = sorted[sorted.length - 1] ?? 0;

    const iterations = Number(innerIterations) > 0 ? Number(innerIterations) : 1;
    const totalOps = iterations * batchSize * measuredIterations;
    const nsPerOp = totalOps > 0 ? (totalMs * 1_000_000) / totalOps : 0;
    const opsPerSec = totalMs > 0 ? totalOps / (totalMs / 1000) : 0;

    return {
        name: name,
        warmup_iterations: warmupIterations,
        warmup_ms: warmupMs,
        measured_iterations: measuredIterations,
        inner_iterations: iterations,
        batch_size: batchSize,
        total_ms: totalMs,
        mean_ms: meanMs,
        median_ms: medianMs,
        p95_ms: p95Ms,
        min_ms: minMs,
        max_ms: maxMs,
        ns_per_op: nsPerOp,
        ops_per_sec: opsPerSec,
        clock_source: clock.source,
        clock_resolution_ms: resolutionMs,
        target_sample_ms: targetSampleMs
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
