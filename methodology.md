# Benchmark Methodology

## Overview

This benchmark suite compares zigttp against Deno across HTTP throughput,
JavaScript execution speed, memory usage, and cold start times.

## Test Environment

All tests run on a single machine with:

- Loopback networking (127.0.0.1)
- Shared endpoint set in `parity` mode
- Runtime-specific optimizations in `implementation` mode
- Logging disabled
- Power management disabled during tests

System specifications are captured in `results/<timestamp>/system_info.json`.

## Modes

### Warm Mode (default)

Server starts once, handles warmup requests, then measured load.

### Cold Mode

Fresh process spawn per measurement iteration. Used for cold start benchmarks.

## HTTP Benchmarks

### Modes

- `parity` (default): endpoints intended for cross-runtime comparisons
- `implementation`: includes optimized/runtime-specific paths
- `floor`: minimal fixed-overhead endpoint (`/api/noop`)

### Warmup Protocol

1. Start server and wait for `/api/health` readiness
2. Send 1000 warmup requests (not measured)
3. Wait 1 second for GC stabilization

### Measurement Protocol

1. Run `hey` with configured connection count for configured duration
2. Capture: requests/second, latency percentiles (p50/p95/p99/max), error rate

### Load Profiles

| Profile        | Connections | Duration |
| -------------- | ----------- | -------- |
| quick          | 1           | 5s       |
| full (default) | 10          | 30s      |

### Endpoints Tested

| Endpoint         | Type | Payload                     |
| ---------------- | ---- | --------------------------- |
| /api/noop        | GET  | static JSON (`{"ok":true}`) |
| /api/health      | GET  | ~60 bytes JSON              |
| /api/greet/:name | GET  | ~40 bytes JSON              |
| /api/compute     | GET  | ~50 bytes JSON              |
| /api/echo        | GET  | implementation mode only    |
| /api/process     | GET  | implementation mode only    |

## Microbenchmarks

### JavaScript Execution Tests

| Benchmark         | Description                              | Iterations |
| ----------------- | ---------------------------------------- | ---------- |
| arithmetic        | Integer math ops                         | 20000      |
| stringOps         | indexOf, length                          | 20000      |
| objectCreate      | Object allocation                        | 20000      |
| propertyAccess    | Property read/write                      | 20000      |
| functionCalls     | Nested function calls                    | 20000      |
| jsonOps           | JSON.stringify/parse                     | 5000       |
| httpHandler       | Response object + JSON body              | 5000       |
| httpHandlerHeavy  | Routing + JSON parse + response assembly | 2000       |
| stringBuild       | String construction patterns             | 10000      |
| dynamicProps      | Dynamic property patterns                | 20000      |
| arrayOps          | Array creation/access/search             | 20000      |
| nestedAccess      | Nested object reads/writes               | 20000      |
| queryParsing      | Query parsing + bounds checks            | 10000      |
| parseInt          | Number parsing                           | 20000      |
| mathOps           | Math.* operations                        | 20000      |
| monoProperty      | Monomorphic property reads               | 20000      |
| monoPropertyWrite | Monomorphic property writes              | 20000      |

### Protocol

- 20 warmup iterations plus a minimum warmup time window (>= 100ms)
- Auto-calibrate batch size per benchmark to reach a target sample duration
  (20–100ms depending on timer resolution)
- 30 measured iterations using calibrated batch size
- High-resolution timers per runtime (hrtime/performance where available;
  Date.now fallback)
- Output: nanoseconds per operation, operations per second, median/p95 sample
  times
- Note: zigttp microbench numbers are collected by running the shared JS suite
  through `zigttp-bench --script` for parity.
- zigttp runs in groups of 8 benchmarks to avoid known instability with larger
  in-process suites.
- Optional overrides via env vars:
  - `BENCH_FILTER` (comma-separated list of benchmarks)
  - `BENCH_WARMUP_ITERATIONS`, `BENCH_MEASURED_ITERATIONS`, `BENCH_WARMUP_MS`,
    `BENCH_MAX_MEASURED_TOTAL_MS`
  - `BENCH_HTTP_HANDLER_HEAVY_ITERATIONS` (inner loop size for httpHandlerHeavy)

## Cold Start

### Definition

Time from process spawn to first successful HTTP response.

### Protocol

1. Record start time (microsecond precision)
2. Spawn server process
3. Poll /api/health every 2ms until 200 response
4. Record end time
5. Kill process

### Iterations

100 iterations per runtime for statistical significance.

## Memory Profiling

### Baseline RSS

Start server, wait 2 seconds, sample resident set size.

### Load RSS

Sample RSS every 100ms during 30-second load test.

## Statistical Analysis

### Metrics

- Mean, median
- Percentiles: p50, p95, p99
- Min/max

## Reproducibility

1. Pin runtime versions in versions.json
2. Record system info with each run
3. Run suite 3x minimum for consistency
4. Report coefficient of variation (CV)

All runs are stored under unique `results/<timestamp>_<pid>_<rand>/` folders to
preserve historical trends.

## Limitations

1. zigttp is FaaS-optimized and intentionally omits some APIs
2. JIT-heavy runtimes (V8, JSC) benefit from long-running warm benchmarks
3. GC metrics are not directly comparable across runtimes
4. Host OS jitter affects results - document CPU governor state
