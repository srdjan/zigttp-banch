// Universal microbenchmark runner
// Works in Deno and zigttp

const isZigttpRuntime = typeof Deno === 'undefined'
    && typeof process === 'undefined'
    && typeof Bun === 'undefined'
    && typeof Response !== 'undefined'
    && typeof Response.json === 'function';

// range() polyfill for Deno (zigttp provides builtin)
if (!isZigttpRuntime && typeof range === 'undefined') {
    function rangePolyfill(n) {
        const result = [];
        if (typeof n !== 'number' || n <= 0) return result;
        const size = n | 0;
        if (size <= 0) return result;
        result.length = size;
        let i = 0;
        while (i < size) {
            result[i] = i;
            i = i + 1;
        }
        return result;
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.range = rangePolyfill;
    }
}
// end range() polyfill

const WARMUP_ITERATIONS = 20;
const MEASURED_ITERATIONS = 30;
const MIN_WARMUP_MS = 100;
const MIN_TARGET_SAMPLE_MS = 20;
const MAX_TARGET_SAMPLE_MS = 100;
const MAX_BATCH_SIZE = 1000000;
const MAX_OPS_PER_SAMPLE = 5000000;
const MAX_MEASURED_TOTAL_MS = 2000;

const benchState = { seed: 1, sink: 0 };

const globalConfig =
    typeof __benchConfig !== 'undefined' && __benchConfig && typeof __benchConfig === 'object'
        ? __benchConfig
        : null;

function probeClock(now) {
    let last = now();
    for (let _ of range(6)) {
        let spin = 0;
        for (let __ of range(20000)) {
            spin = spin + 1;
        }
        const current = now();
        if (current > last) {
            return true;
        }
        last = current;
    }
    return false;
}

function getClock() {
    if (isZigttpRuntime) {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return { now: () => performance.now(), source: 'performance.now' };
        }
        if (typeof Date !== 'undefined' && typeof Date.now === 'function') {
            return { now: () => Date.now(), source: 'Date.now' };
        }
        return { now: () => 0, source: 'none' };
    }
    const candidates = [];
    let candidateCount = 0;
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        candidates[candidateCount] = { now: () => performance.now(), source: 'performance.now' };
        candidateCount = candidateCount + 1;
    }
    if (typeof Date !== 'undefined' && typeof Date.now === 'function') {
        candidates[candidateCount] = { now: () => Date.now(), source: 'Date.now' };
        candidateCount = candidateCount + 1;
    }
    for (let i of range(candidateCount)) {
        const candidate = candidates[i];
        if (probeClock(candidate.now)) {
            return candidate;
        }
    }
    return { now: () => 0, source: 'none' };
}

function estimateResolutionMs(now) {
    let last = now();
    let minDelta = Infinity;
    for (let _ of range(1000)) {
        const current = now();
        const delta = current - last;
        if (delta > 0 && delta < minDelta) {
            minDelta = delta;
        }
        last = current;
    }
    return minDelta === Infinity ? 1 : minDelta;
}

function percentileFromSorted(sorted, count, p) {
    if (!count) return 0;
    const idx = Math.min(count - 1, Math.max(0, Math.ceil(p * count) - 1));
    return sorted[idx];
}

function sortAscending(values, count) {
    const arr = [];
    for (let i of range(count)) {
        arr[i] = values[i];
    }
    if (count <= 1) return arr;

    for (let i of range(count - 1)) {
        const limit = count - 1 - i;
        for (let j of range(limit)) {
            const a = arr[j];
            const b = arr[j + 1];
            if (a > b) {
                arr[j] = b;
                arr[j + 1] = a;
            }
        }
    }
    return arr;
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
    for (let _ of range(batchSize)) {
        const result = fn(seed);
        consume(result);
        seed = (seed + 1) | 0;
    }
    benchState.seed = seed;
}

function calibrateBatch(fn, now, targetSampleMs, resolutionMs, maxBatchSize) {
    let batchSize = 1;
    let elapsed = 0;

    let done = false;
    for (let _ of range(20)) {
        if (!done) {
            const start = now();
            runBatch(fn, batchSize);
            elapsed = now() - start;
            if (elapsed >= targetSampleMs) {
                done = true;
            } else if (elapsed <= 0) {
                const fallbackMs = resolutionMs > 0 ? resolutionMs : 1;
                elapsed = fallbackMs;
                const scale = targetSampleMs / elapsed;
                batchSize = Math.min(maxBatchSize, Math.max(batchSize + 1, Math.ceil(batchSize * scale)));
            } else {
                const scale = targetSampleMs / elapsed;
                batchSize = Math.min(maxBatchSize, Math.max(batchSize + 1, Math.ceil(batchSize * scale)));
            }
        }
    }

    return { batchSize, elapsed };
}

// Run a single benchmark
function benchmark(name, fn, innerIterations, options) {
    const clock = getClock();
    const now = clock.now;
    const iterations =
        (typeof innerIterations === 'number' && innerIterations > 0)
            ? innerIterations
            : 1;
    const opts = options && typeof options === 'object' ? options : {};

    const warmupIterations =
        (opts.warmupIterations === undefined || opts.warmupIterations === null)
            ? (globalConfig && globalConfig.warmupIterations !== undefined
                ? globalConfig.warmupIterations
                : WARMUP_ITERATIONS)
            : opts.warmupIterations;
    const measuredIterations =
        (opts.measuredIterations === undefined || opts.measuredIterations === null)
            ? (globalConfig && globalConfig.measuredIterations !== undefined
                ? globalConfig.measuredIterations
                : MEASURED_ITERATIONS)
            : opts.measuredIterations;

    // zigttp-specific path: simplified calibration to avoid heavy loops
    // Note: zigttp does not support 'break' statements, so we use done flags
    if (isZigttpRuntime) {
        // Phase 1: Initial warmup to trigger JIT compilation
        // Run enough iterations at increasing batch sizes to warm up the JIT
        for (let _ of range(warmupIterations)) {
            runBatch(fn, 1);
        }
        // Additional warmup at larger batch to ensure JIT optimizes the hot path
        for (let _ of range(10)) {
            runBatch(fn, 10);
        }

        // Phase 2: Calibrate batch size AFTER JIT warmup
        // The target is to get samples that take at least targetMs
        const targetMs = 5;
        const minSampleMs = 1;  // Minimum acceptable sample time for accuracy
        let batchSize = 10;
        let elapsed = 0;
        let calibrationDone = false;

        for (let _ of range(20)) {
            if (!calibrationDone) {
                const start = now();
                runBatch(fn, batchSize);
                elapsed = now() - start;
                if (elapsed >= targetMs) {
                    calibrationDone = true;
                } else {
                    // Double batch size, but cap at reasonable limit
                    batchSize = batchSize * 2;
                    if (batchSize > 50000) {
                        batchSize = 50000;
                        calibrationDone = true;
                    }
                }
            }
        }

        // Phase 3: Post-calibration warmup at the calibrated batch size
        // This ensures the JIT is fully warmed up for the actual batch size
        for (let _ of range(5)) {
            runBatch(fn, batchSize);
        }

        // Phase 4: Measured phase with calibrated batch size
        let totalMs = 0;
        let minMs = 0;
        let maxMs = 0;
        let count = 0;
        for (let _ of range(measuredIterations)) {
            const start = now();
            runBatch(fn, batchSize);
            const sampleElapsed = now() - start;
            totalMs = totalMs + sampleElapsed;
            if (count === 0 || sampleElapsed < minMs) {
                minMs = sampleElapsed;
            }
            if (count === 0 || sampleElapsed > maxMs) {
                maxMs = sampleElapsed;
            }
            count = count + 1;
        }

        // If samples are too fast (< minSampleMs), timing is unreliable
        // Report what we have but flag it
        const meanMs = count > 0 ? totalMs / count : 0;
        const totalOps = iterations * batchSize * measuredIterations;
        const nsPerOp = totalOps > 0 ? (totalMs * 1000000) / totalOps : 0;
        const opsPerSec = totalMs > 0 ? totalOps / (totalMs / 1000) : 0;

        return {
            name: name,
            warmup_iterations: warmupIterations,
            warmup_ms: 0,
            measured_iterations: measuredIterations,
            inner_iterations: iterations,
            batch_size: batchSize,
            total_ms: totalMs,
            mean_ms: meanMs,
            median_ms: meanMs,
            p95_ms: maxMs,
            min_ms: minMs,
            max_ms: maxMs,
            ns_per_op: nsPerOp,
            ops_per_sec: opsPerSec,
            clock_source: clock.source,
            clock_resolution_ms: 0,
            target_sample_ms: targetMs
        };
    }

    // Deno/standard path: full calibration with resolution estimation
    const resolutionMs = estimateResolutionMs(now);
    const targetSampleMs = Math.min(
        MAX_TARGET_SAMPLE_MS,
        Math.max(MIN_TARGET_SAMPLE_MS, resolutionMs * 50)
    );
    const warmupMs =
        (opts.warmupMs === undefined || opts.warmupMs === null)
            ? (globalConfig && globalConfig.warmupMs !== undefined
                ? globalConfig.warmupMs
                : Math.max(MIN_WARMUP_MS, targetSampleMs))
            : opts.warmupMs;
    const maxMeasuredTotalMs =
        (opts.maxMeasuredTotalMs === undefined || opts.maxMeasuredTotalMs === null)
            ? (globalConfig && globalConfig.maxMeasuredTotalMs !== undefined
                ? globalConfig.maxMeasuredTotalMs
                : MAX_MEASURED_TOTAL_MS)
            : opts.maxMeasuredTotalMs;

    let maxBatchSize = MAX_BATCH_SIZE;
    if (iterations > 0) {
        const maxByOps = Math.floor(MAX_OPS_PER_SAMPLE / iterations);
        if (maxByOps > 0) {
            maxBatchSize = Math.min(maxBatchSize, maxByOps);
        } else {
            maxBatchSize = 1;
        }
    }

    // Warmup phase (iterations + time-based, capped for runtimes with coarse clocks)
    for (let _ of range(warmupIterations)) {
        runBatch(fn, 1);
    }
    const warmupStart = now();
    let warmupTimeLimit = warmupIterations * 10;
    if (warmupTimeLimit < 50) {
        warmupTimeLimit = 50;
    }
    let warmed = false;
    for (let _ of range(warmupTimeLimit)) {
        if (!warmed) {
            if ((now() - warmupStart) >= warmupMs) {
                warmed = true;
            } else {
                runBatch(fn, 1);
            }
        }
    }

    // Calibrate batch size to get stable samples
    const calibration = calibrateBatch(fn, now, targetSampleMs, resolutionMs, maxBatchSize);
    const batchSize = calibration.batchSize;

    let measuredIterationsFinal = measuredIterations;
    if (calibration.elapsed > 0 && maxMeasuredTotalMs > 0) {
        const estimatedTotalMs = calibration.elapsed * measuredIterations;
        if (estimatedTotalMs > maxMeasuredTotalMs) {
            const scaled = Math.ceil(maxMeasuredTotalMs / calibration.elapsed);
            measuredIterationsFinal = Math.max(5, Math.min(measuredIterations, scaled));
        }
    }

    // Measured phase (Deno path only - zigttp returns early above)
    const results = [];
    let resultsCount = 0;
    for (let _ of range(measuredIterationsFinal)) {
        const start = now();
        runBatch(fn, batchSize);
        const elapsed = now() - start;
        results[resultsCount] = elapsed;
        resultsCount = resultsCount + 1;
    }

    // Calculate statistics
    let totalMs = 0;
    for (let i of range(resultsCount)) {
        totalMs = totalMs + results[i];
    }
    const meanMs = resultsCount > 0 ? totalMs / resultsCount : 0;
    const sorted = sortAscending(results, resultsCount);
    const medianMs = percentileFromSorted(sorted, resultsCount, 0.5);
    const p95Ms = percentileFromSorted(sorted, resultsCount, 0.95);
    const minMs = resultsCount > 0 ? sorted[0] : 0;
    const maxMs = resultsCount > 0 ? sorted[resultsCount - 1] : 0;

    const totalOps = iterations * batchSize * measuredIterationsFinal;
    const nsPerOp = totalOps > 0 ? (totalMs * 1000000) / totalOps : 0;
    const opsPerSec = totalMs > 0 ? totalOps / (totalMs / 1000) : 0;

    return {
        name: name,
        warmup_iterations: warmupIterations,
        warmup_ms: warmupMs,
        measured_iterations: measuredIterationsFinal,
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
    if (typeof Deno !== 'undefined') return 'deno';
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof process !== 'undefined' && process.versions && process.versions.node) return 'node';
    if (typeof Response !== 'undefined' && typeof Response.json === 'function') return 'zigttp';
    return 'unknown';
}

// Export for module systems
if (typeof globalThis !== 'undefined') {
    globalThis.benchmark = benchmark;
    globalThis.detectRuntime = detectRuntime;
}
