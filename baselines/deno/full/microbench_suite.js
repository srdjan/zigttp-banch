// Universal microbenchmark runner
// Works in Deno and zigttp

if (typeof range === 'undefined') {
    const rangeFactory = Function(
        'n',
        'var size = n | 0;' +
            'if (size <= 0) { return []; }' +
            'var arr = new Array(size);' +
            'for (var i = 0; i < size; i++) { arr[i] = i; }' +
            'return arr;'
    );

    function range(n) {
        if (typeof n !== 'number' || n <= 0) return [];
        return rangeFactory(n);
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.range = range;
    }
}

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

const isZigttpRuntime =
    typeof Response !== 'undefined' &&
    typeof Response.json === 'function' &&
    typeof Deno === 'undefined';

function toMsFromNs(value) {
    if (typeof value === 'bigint') {
        return Number(value) / 1000000;
    }
    return value / 1000000;
}

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
    if (isZigttpRuntime) {
        // Simple warmup
        for (let _ of range(warmupIterations)) {
            runBatch(fn, 1);
        }

        // Calibrate batch size: start at 1, double until we get >= 10ms samples
        // This avoids the 1000-iteration resolution estimation loop
        const targetMs = 20;
        let batchSize = 1;
        let elapsed = 0;
        for (let _ of range(15)) {
            const start = now();
            runBatch(fn, batchSize);
            elapsed = now() - start;
            if (elapsed >= targetMs) {
                break;
            }
            // Double batch size, but cap at reasonable limit
            batchSize = batchSize * 2;
            if (batchSize > 10000) {
                batchSize = 10000;
                break;
            }
        }

        // Measured phase with calibrated batch size
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
    if (typeof Response !== 'undefined' && typeof Response.json === 'function') return 'zigttp';
    return 'unknown';
}

// Export for module systems
if (typeof globalThis !== 'undefined') {
    globalThis.benchmark = benchmark;
    globalThis.detectRuntime = detectRuntime;
}
// Integer arithmetic benchmark
// Tests basic math operations performance

const ARITHMETIC_ITERATIONS = 50000;

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
// Array operations benchmark
// Tests array creation, access, and search operations

const ARRAY_OPS_ITERATIONS = 20000;

function runArrayOps(seed) {
    if (seed === undefined) seed = 0;
    let result = 0;

    for (let i of range(ARRAY_OPS_ITERATIONS)) {
        // Pattern 1: Array literal creation and element access
        const base = (i + seed) % 100;
        const arr = [base, base + 1, base + 2, base + 3, base + 4,
                     base + 5, base + 6, base + 7, base + 8, base + 9];
        result = (result + arr.length) % 1000000;

        // Pattern 2: Sequential element access
        for (let j of range(10)) {
            result = (result + arr[j]) % 1000000;
        }

        // Pattern 3: indexOf searches
        for (let k of range(5)) {
            const target = base + k * 2;
            const idx = arr.indexOf(target);
            if (idx >= 0) {
                result = (result + idx) % 1000000;
            }
        }

        // Pattern 4: includes checks
        for (let m of range(5)) {
            const target = base + m;
            if (arr.includes(target)) {
                result = (result + 1) % 1000000;
            }
        }

        // Pattern 5: join and string length
        const joined = arr.join(',');
        result = (result + joined.length) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runArrayOps, INNER_ITERATIONS: ARRAY_OPS_ITERATIONS, name: 'arrayOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runArrayOps = runArrayOps;
    globalThis.ARRAY_OPS_ITERATIONS = ARRAY_OPS_ITERATIONS;
}
// Dynamic property access benchmark
// Tests obj.prop patterns - zigttp does not support bracket notation on objects

const DYNAMIC_PROPS_ITERATIONS = 20000;

function runDynamicProps(seed) {
    if (seed === undefined) seed = 0;
    // Use direct property access since zigttp doesn't support obj[key]
    const obj = {
        p0: 1, p1: 2, p2: 3, p3: 4, p4: 5,
        p5: 6, p6: 7, p7: 8, p8: 9, p9: 10
    };
    let sum = 0;

    for (let iter of range(DYNAMIC_PROPS_ITERATIONS)) {
        // Direct property reads in sequence (simulates dynamic access pattern)
        const idx = (iter + seed) % 10;

        // Read all properties in rotation based on idx
        if (idx === 0) {
            sum = (sum + obj.p0 + obj.p1 + obj.p2) % 1000000;
            obj.p0 = (obj.p0 + 1) % 100;
        } else if (idx === 1) {
            sum = (sum + obj.p1 + obj.p2 + obj.p3) % 1000000;
            obj.p1 = (obj.p1 + 1) % 100;
        } else if (idx === 2) {
            sum = (sum + obj.p2 + obj.p3 + obj.p4) % 1000000;
            obj.p2 = (obj.p2 + 1) % 100;
        } else if (idx === 3) {
            sum = (sum + obj.p3 + obj.p4 + obj.p5) % 1000000;
            obj.p3 = (obj.p3 + 1) % 100;
        } else if (idx === 4) {
            sum = (sum + obj.p4 + obj.p5 + obj.p6) % 1000000;
            obj.p4 = (obj.p4 + 1) % 100;
        } else if (idx === 5) {
            sum = (sum + obj.p5 + obj.p6 + obj.p7) % 1000000;
            obj.p5 = (obj.p5 + 1) % 100;
        } else if (idx === 6) {
            sum = (sum + obj.p6 + obj.p7 + obj.p8) % 1000000;
            obj.p6 = (obj.p6 + 1) % 100;
        } else if (idx === 7) {
            sum = (sum + obj.p7 + obj.p8 + obj.p9) % 1000000;
            obj.p7 = (obj.p7 + 1) % 100;
        } else if (idx === 8) {
            sum = (sum + obj.p8 + obj.p9 + obj.p0) % 1000000;
            obj.p8 = (obj.p8 + 1) % 100;
        } else {
            sum = (sum + obj.p9 + obj.p0 + obj.p1) % 1000000;
            obj.p9 = (obj.p9 + 1) % 100;
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
    for (let i of range(FUNCTION_CALLS_ITERATIONS)) {
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
// HTTP handler simulation (heavy)
// Exercises routing, JSON parse, object mutation, and response assembly

const DEFAULT_HTTP_HANDLER_HEAVY_ITERATIONS = 2000;
let HTTP_HANDLER_HEAVY_ITERATIONS = DEFAULT_HTTP_HANDLER_HEAVY_ITERATIONS;
if (typeof __httpHandlerHeavyIterations !== 'undefined' && __httpHandlerHeavyIterations) {
    const override = __httpHandlerHeavyIterations;
    if (override > 0) {
        HTTP_HANDLER_HEAVY_ITERATIONS = override;
    }
}

function runHttpHandlerHeavy(seed = 0) {
    let responses = 0;
    const baseHeaders = {
        contentType: 'application/json',
        cacheControl: 'no-store'
    };
    const payload = JSON.stringify({
        id: seed & 0xff,
        name: 'User' + (seed & 7),
        tags: ['alpha', 'beta', 'gamma']
    });

    for (let i of range(HTTP_HANDLER_HEAVY_ITERATIONS)) {
        const reqPath = (i + seed) % 3 === 0 ? '/api/users' : '/api/users/42';
        const query = (i + seed) % 2 === 0 ? '?limit=10&offset=5' : '?limit=25&offset=0';

        let limit = 10;
        let offset = 0;
        if (query.indexOf('limit=25') !== -1) {
            limit = 25;
        }
        if (query.indexOf('offset=5') !== -1) {
            offset = 5;
        }

        let bodyObj = null;
        if (reqPath.indexOf('/api/users') === 0) {
            bodyObj = JSON.parse(payload);
            bodyObj.limit = limit;
            bodyObj.offset = offset;
        }

        const headers = {
            contentType: baseHeaders.contentType,
            cacheControl: baseHeaders.cacheControl,
            xRequestId: 'req-' + ((i + seed) % 1000)
        };

        const response = {
            status: reqPath === '/api/users' ? 200 : 201,
            headers: headers,
            body: JSON.stringify({
                ok: true,
                path: reqPath,
                data: bodyObj
            })
        };

        responses = (responses + response.body.length + response.status) % 1000000;
    }

    return responses;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        runHttpHandlerHeavy,
        INNER_ITERATIONS: HTTP_HANDLER_HEAVY_ITERATIONS,
        name: 'httpHandlerHeavy'
    };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runHttpHandlerHeavy = runHttpHandlerHeavy;
    globalThis.HTTP_HANDLER_HEAVY_ITERATIONS = HTTP_HANDLER_HEAVY_ITERATIONS;
}
// HTTP handler simulation benchmark
// Tests object creation + JSON stringify like a typical response

const HTTP_HANDLER_ITERATIONS = 5000;

function runHttpHandler(seed = 0) {
    let responses = 0;
    for (let i of range(HTTP_HANDLER_ITERATIONS)) {
        const response = {
            status: 200,
            body: JSON.stringify({ id: (i + seed) % 100, name: 'User' + (seed & 7) })
        };
        responses = (responses + response.body.length) % 1000000;
    }
    return responses;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runHttpHandler, INNER_ITERATIONS: HTTP_HANDLER_ITERATIONS, name: 'httpHandler' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runHttpHandler = runHttpHandler;
    globalThis.HTTP_HANDLER_ITERATIONS = HTTP_HANDLER_ITERATIONS;
}
// JSON operations benchmark
// Tests JSON.stringify and JSON.parse performance

const JSON_OPS_ITERATIONS = 5000;

function runJsonOps(seed = 0) {
    const obj = { users: [{ id: 1 }, { id: 2 }], seed: 0 };
    obj.seed = seed;
    obj.users[0].id = (seed & 0xff) + 1;
    obj.users[1].id = (seed & 0xff) + 2;
    let count = 0;
    for (let _ of range(JSON_OPS_ITERATIONS)) {
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        count = (count + parsed.users.length) % 1000000;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runJsonOps, INNER_ITERATIONS: JSON_OPS_ITERATIONS, name: 'jsonOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runJsonOps = runJsonOps;
    globalThis.JSON_OPS_ITERATIONS = JSON_OPS_ITERATIONS;
}
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runMathOps, INNER_ITERATIONS: MATH_OPS_ITERATIONS, name: 'mathOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runMathOps = runMathOps;
    globalThis.MATH_OPS_ITERATIONS = MATH_OPS_ITERATIONS;
}
// Nested object access benchmark
// Tests deep property chain access patterns

const NESTED_ACCESS_ITERATIONS = 20000;

function runNestedAccess(seed = 0) {
    // Create nested structure
    const data = {
        user: {
            profile: {
                name: 'test',
                age: 25 + (seed & 0xf),
                settings: {
                    theme: 'dark',
                    notifications: true,
                    count: seed
                }
            },
            stats: {
                visits: 100,
                posts: 50
            }
        },
        meta: {
            version: 1,
            timestamp: 12345
        }
    };

    let result = 0;

    for (let i of range(NESTED_ACCESS_ITERATIONS)) {
        // Deep reads (3-4 levels)
        result = (result + data.user.profile.age) % 1000000;
        result = (result + data.user.profile.settings.count) % 1000000;
        result = (result + data.user.stats.visits) % 1000000;
        result = (result + data.meta.version) % 1000000;

        // Deep writes
        data.user.profile.settings.count = (i + seed) % 1000;
        data.user.stats.visits = (data.user.stats.visits + 1) % 10000;

        // Mixed read after write
        result = (result + data.user.profile.settings.count) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runNestedAccess, INNER_ITERATIONS: NESTED_ACCESS_ITERATIONS, name: 'nestedAccess' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runNestedAccess = runNestedAccess;
    globalThis.NESTED_ACCESS_ITERATIONS = NESTED_ACCESS_ITERATIONS;
}
// Object creation benchmark
// Tests object allocation patterns

const OBJECT_CREATE_ITERATIONS = 50000;

function runObjectCreate(seed) {
    if (seed === undefined) seed = 0;
    let count = 0;
    let lastObj = null;

    for (let i of range(OBJECT_CREATE_ITERATIONS)) {
        // Create new object each iteration
        const obj = { id: i + seed, name: 'item' + (seed % 4), value: i * 2 };

        // Access properties to ensure object is actually used
        count = (count + obj.id + obj.value) % 1000000;

        // Create nested objects periodically
        if ((i % 10) === 0) {
            const nested = { parent: lastObj, data: { x: i, y: seed } };
            count = (count + nested.data.x) % 1000000;
        }

        lastObj = obj;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runObjectCreate, INNER_ITERATIONS: OBJECT_CREATE_ITERATIONS, name: 'objectCreate' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runObjectCreate = runObjectCreate;
    globalThis.OBJECT_CREATE_ITERATIONS = OBJECT_CREATE_ITERATIONS;
}
// parseInt isolation benchmark
// Tests number parsing performance in isolation

const PARSE_INT_ITERATIONS = 20000;

function runParseInt(seed = 0) {
    let result = 0;

    // Pre-defined numeric strings to avoid string creation overhead
    const numStrs = ['0', '1', '42', '100', '999', '1234', '9999', '12345'];

    for (let i of range(PARSE_INT_ITERATIONS)) {
        const str = numStrs[(i + seed) % 8];

        // Pure parseInt calls
        const n1 = parseInt(str, 10);
        const n2 = parseInt(str, 10);
        const n3 = parseInt(str, 10);
        const n4 = parseInt(str, 10);

        result = (result + n1 + n2 + n3 + n4) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runParseInt, INNER_ITERATIONS: PARSE_INT_ITERATIONS, name: 'parseInt' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runParseInt = runParseInt;
    globalThis.PARSE_INT_ITERATIONS = PARSE_INT_ITERATIONS;
}
// Property access benchmark
// Tests object property read/write performance

const PROPERTY_ACCESS_ITERATIONS = 50000;

function runPropertyAccess(seed = 0) {
    const obj = { a: seed & 0xff, b: 2, c: 3, d: 4, e: 5 };
    let sum = 0;
    for (let i of range(PROPERTY_ACCESS_ITERATIONS)) {
        sum = (sum + obj.a + obj.b + obj.c + obj.d + obj.e) % 1000000;
        obj.a = (i + seed) % 100;
    }
    return sum;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runPropertyAccess, INNER_ITERATIONS: PROPERTY_ACCESS_ITERATIONS, name: 'propertyAccess' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runPropertyAccess = runPropertyAccess;
    globalThis.PROPERTY_ACCESS_ITERATIONS = PROPERTY_ACCESS_ITERATIONS;
}
// Query parameter parsing benchmark
// Tests parseInt, Math functions, and string operations - common FaaS operations

const QUERY_PARSING_ITERATIONS = 10000;

function runQueryParsing(seed = 0) {
    let result = 0;

    // Simulate various query strings
    const queries = [
        'page=1&limit=10&offset=0',
        'page=5&limit=25&offset=100',
        'page=12&limit=50&offset=550',
        'id=42&count=7&max=999'
    ];

    for (let i of range(QUERY_PARSING_ITERATIONS)) {
        const queryStr = queries[(i + seed) % 4];

        // Pattern 1: Parse common pagination params using indexOf with start position
        let page = 1;
        let limit = 10;
        let offset = 0;

        // Parse page
        const pageIdx = queryStr.indexOf('page=');
        if (pageIdx !== -1) {
            const ampIdx = queryStr.indexOf('&', pageIdx + 5);
            const valStr = ampIdx === -1
                ? queryStr.slice(pageIdx + 5)
                : queryStr.slice(pageIdx + 5, ampIdx);
            page = parseInt(valStr, 10);
        }

        // Parse limit
        const limitIdx = queryStr.indexOf('limit=');
        if (limitIdx !== -1) {
            const ampIdx = queryStr.indexOf('&', limitIdx + 6);
            const valStr = ampIdx === -1
                ? queryStr.slice(limitIdx + 6)
                : queryStr.slice(limitIdx + 6, ampIdx);
            limit = parseInt(valStr, 10);
        }

        // Parse offset
        const offsetIdx = queryStr.indexOf('offset=');
        if (offsetIdx !== -1) {
            const ampIdx = queryStr.indexOf('&', offsetIdx + 7);
            const valStr = ampIdx === -1
                ? queryStr.slice(offsetIdx + 7)
                : queryStr.slice(offsetIdx + 7, ampIdx);
            offset = parseInt(valStr, 10);
        }

        // Pattern 2: Math operations (pagination calculations)
        const totalItems = 1000 + (seed & 0xff);
        const totalPages = Math.ceil(totalItems / limit);
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const startIdx = Math.floor((currentPage - 1) * limit);
        const endIdx = Math.min(startIdx + limit, totalItems);

        // Pattern 3: Bounds validation
        const clampedOffset = Math.max(0, Math.min(offset, totalItems - 1));
        const remaining = Math.abs(totalItems - clampedOffset);

        result = (result + page + limit + offset + totalPages + startIdx + endIdx + remaining) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runQueryParsing, INNER_ITERATIONS: QUERY_PARSING_ITERATIONS, name: 'queryParsing' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runQueryParsing = runQueryParsing;
    globalThis.QUERY_PARSING_ITERATIONS = QUERY_PARSING_ITERATIONS;
}
// String building benchmark
// Tests various patterns for constructing strings

const STRING_BUILD_ITERATIONS = 10000;

function runStringBuild(seed = 0) {
    let result = 0;

    for (let i of range(STRING_BUILD_ITERATIONS)) {
        // Pattern 1: Concatenation chain
        let s1 = 'id=' + ((i + seed) % 100) + '&name=user' + (seed & 7);
        result = (result + s1.length) % 1000000;

        // Pattern 2: Multiple concatenations
        let s2 = 'prefix';
        s2 = s2 + '-';
        s2 = s2 + ((i * seed) % 50);
        s2 = s2 + '-suffix';
        result = (result + s2.length) % 1000000;

        // Pattern 3: Building with array join (if supported)
        // Simulated with concat for now
        let parts = 'a' + ',' + 'b' + ',' + 'c' + ',' + ((seed + i) % 10);
        result = (result + parts.length) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runStringBuild, INNER_ITERATIONS: STRING_BUILD_ITERATIONS, name: 'stringBuild' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runStringBuild = runStringBuild;
    globalThis.STRING_BUILD_ITERATIONS = STRING_BUILD_ITERATIONS;
}
// String operations benchmark
// Tests indexOf and length operations

const STRING_OPS_ITERATIONS = 50000;

function runStringOps(seed = 0) {
    const str = 'The quick brown fox jumps over the lazy dog';
    const needle = (seed & 1) ? 'fox' : 'dog';
    let count = 0;
    for (let _ of range(STRING_OPS_ITERATIONS)) {
        count = (count + str.indexOf(needle)) % 1000000;
        count = (count + str.length + (seed & 7)) % 1000000;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runStringOps, INNER_ITERATIONS: STRING_OPS_ITERATIONS, name: 'stringOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runStringOps = runStringOps;
    globalThis.STRING_OPS_ITERATIONS = STRING_OPS_ITERATIONS;
}
// Microbenchmark suite entrypoint

const runtime = typeof detectRuntime === 'function' ? detectRuntime() : 'unknown';
const rawFilter = typeof __benchFilter !== 'undefined' ? ('' + __benchFilter) : '';
const hasFilter = rawFilter !== '';

let filterArithmetic = false;
let filterStringOps = false;
let filterObjectCreate = false;
let filterPropertyAccess = false;
let filterFunctionCalls = false;
let filterJsonOps = false;
let filterHttpHandler = false;
let filterHttpHandlerHeavy = false;
let filterStringBuild = false;
let filterDynamicProps = false;
let filterArrayOps = false;
let filterNestedAccess = false;
let filterQueryParsing = false;
let filterParseInt = false;
let filterMathOps = false;

if (hasFilter) {
    let start = 0;
    let done = false;
    for (let _ of range(rawFilter.length + 1)) {
        if (!done) {
            const idx = rawFilter.indexOf(',', start);
            const name = idx === -1 ? rawFilter.slice(start) : rawFilter.slice(start, idx);
            if (name === 'arithmetic') {
                filterArithmetic = true;
            } else if (name === 'stringOps') {
                filterStringOps = true;
            } else if (name === 'objectCreate') {
                filterObjectCreate = true;
            } else if (name === 'propertyAccess') {
                filterPropertyAccess = true;
            } else if (name === 'functionCalls') {
                filterFunctionCalls = true;
            } else if (name === 'jsonOps') {
                filterJsonOps = true;
            } else if (name === 'httpHandler') {
                filterHttpHandler = true;
            } else if (name === 'httpHandlerHeavy') {
                filterHttpHandlerHeavy = true;
            } else if (name === 'stringBuild') {
                filterStringBuild = true;
            } else if (name === 'dynamicProps') {
                filterDynamicProps = true;
            } else if (name === 'arrayOps') {
                filterArrayOps = true;
            } else if (name === 'nestedAccess') {
                filterNestedAccess = true;
            } else if (name === 'queryParsing') {
                filterQueryParsing = true;
            } else if (name === 'parseInt') {
                filterParseInt = true;
            } else if (name === 'mathOps') {
                filterMathOps = true;
            }
            if (idx === -1) {
                done = true;
            } else {
                start = idx + 1;
            }
        }
    }
}

const results = {};

function runBench(name, fn, iterations) {
    if (typeof fn !== 'function' || !iterations) {
        return { name: name, error: 'missing benchmark', runtime: runtime };
    }
    const result = benchmark(name, fn, iterations);
    result.runtime = runtime;
    return result;
}

if (!hasFilter || filterArithmetic) {
    results.arithmetic = runBench('arithmetic', runArithmetic, ARITHMETIC_ITERATIONS);
}
if (!hasFilter || filterStringOps) {
    results.stringOps = runBench('stringOps', runStringOps, STRING_OPS_ITERATIONS);
}
if (!hasFilter || filterObjectCreate) {
    results.objectCreate = runBench('objectCreate', runObjectCreate, OBJECT_CREATE_ITERATIONS);
}
if (!hasFilter || filterPropertyAccess) {
    results.propertyAccess = runBench('propertyAccess', runPropertyAccess, PROPERTY_ACCESS_ITERATIONS);
}
if (!hasFilter || filterFunctionCalls) {
    results.functionCalls = runBench('functionCalls', runFunctionCalls, FUNCTION_CALLS_ITERATIONS);
}
if (!hasFilter || filterJsonOps) {
    results.jsonOps = runBench('jsonOps', runJsonOps, JSON_OPS_ITERATIONS);
}
if (!hasFilter || filterHttpHandler) {
    results.httpHandler = runBench('httpHandler', runHttpHandler, HTTP_HANDLER_ITERATIONS);
}
if (!hasFilter || filterHttpHandlerHeavy) {
    results.httpHandlerHeavy = runBench('httpHandlerHeavy', runHttpHandlerHeavy, HTTP_HANDLER_HEAVY_ITERATIONS);
}
if (!hasFilter || filterStringBuild) {
    results.stringBuild = runBench('stringBuild', runStringBuild, STRING_BUILD_ITERATIONS);
}
if (!hasFilter || filterDynamicProps) {
    results.dynamicProps = runBench('dynamicProps', runDynamicProps, DYNAMIC_PROPS_ITERATIONS);
}
if (!hasFilter || filterArrayOps) {
    results.arrayOps = runBench('arrayOps', runArrayOps, ARRAY_OPS_ITERATIONS);
}
if (!hasFilter || filterNestedAccess) {
    results.nestedAccess = runBench('nestedAccess', runNestedAccess, NESTED_ACCESS_ITERATIONS);
}
if (!hasFilter || filterQueryParsing) {
    results.queryParsing = runBench('queryParsing', runQueryParsing, QUERY_PARSING_ITERATIONS);
}
if (!hasFilter || filterParseInt) {
    results.parseInt = runBench('parseInt', runParseInt, PARSE_INT_ITERATIONS);
}
if (!hasFilter || filterMathOps) {
    results.mathOps = runBench('mathOps', runMathOps, MATH_OPS_ITERATIONS);
}

console.log(JSON.stringify(results, null, 2));