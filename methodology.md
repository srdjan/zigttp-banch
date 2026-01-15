# Benchmark Methodology

## Overview

This benchmark suite compares zigttp against Deno across HTTP throughput, JavaScript execution speed, memory usage, and cold start times.

## Test Environment

All tests run on a single machine with:
- Loopback networking (127.0.0.1)
- Identical response payloads across runtimes
- Logging disabled
- Power management disabled during tests

System specifications are captured in `results/<timestamp>/system_info.json`.

## Modes

### Warm Mode (default)
Server starts once, handles warmup requests, then measured load.

### Cold Mode
Fresh process spawn per measurement iteration. Used for cold start benchmarks.

## HTTP Benchmarks

### Warmup Protocol
1. Start server, wait 2 seconds for initialization
2. Send 1000 warmup requests (not measured)
3. Wait 1 second for GC stabilization

### Measurement Protocol
1. Run `hey` with specified connection count for 30 seconds
2. Capture: requests/second, latency percentiles (p50/p95/p99/max), error rate

### Load Profiles

| Profile | Connections | Duration |
|---------|-------------|----------|
| light | 1 | 30s |
| moderate | 10 | 30s |
| heavy | 100 | 30s |
| extreme | 1000 | 30s |

### Endpoints Tested

| Endpoint | Type | Payload |
|----------|------|---------|
| /api/health | GET | ~60 bytes JSON |
| /api/echo | GET | ~100 bytes JSON |
| /api/greet/:name | GET | ~40 bytes JSON |

## Microbenchmarks

### JavaScript Execution Tests

| Benchmark | Description | Iterations |
|-----------|-------------|------------|
| arithmetic | Integer math ops | 50000 |
| stringOps | indexOf, length | 50000 |
| objectCreate | Object allocation | 50000 |
| propertyAccess | Property read/write | 50000 |
| functionCalls | Nested function calls | 50000 |
| jsonOps | JSON.stringify/parse | 5000 |
| httpHandler | Response object + JSON body | 5000 |
| httpHandlerHeavy | Routing + JSON parse + response assembly | 2000 |

### Protocol
- 20 warmup iterations plus a minimum warmup time window (>= 100ms)
- Auto-calibrate batch size per benchmark to reach a target sample duration (20–100ms depending on timer resolution)
- 30 measured iterations using calibrated batch size
- High-resolution timers per runtime (hrtime/performance where available; Date.now fallback)
- Output: nanoseconds per operation, operations per second, median/p95 sample times
- Note: zigttp microbench numbers are collected by running the shared JS suite through `zigttp-bench --script` for parity.
- Optional overrides via env vars:
  - `BENCH_FILTER` (comma-separated list of benchmarks)
  - `BENCH_WARMUP_ITERATIONS`, `BENCH_MEASURED_ITERATIONS`, `BENCH_WARMUP_MS`, `BENCH_MAX_MEASURED_TOTAL_MS`
  - `BENCH_HTTP_HANDLER_HEAVY_ITERATIONS` (inner loop size for httpHandlerHeavy)

## Cold Start

### Definition
Time from process spawn to first successful HTTP response.

### Protocol
1. Record start time (microsecond precision)
2. Spawn server process
3. Poll /api/health every 10ms until 200 response
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
- Mean, median, standard deviation
- Percentiles: p50, p95, p99
- 95% confidence intervals for means

### Significance Testing
Mann-Whitney U test for comparing distributions between runtimes.
Significance threshold: p < 0.05.

## Reproducibility

1. Pin runtime versions in versions.json
2. Record system info with each run
3. Run suite 3x minimum for consistency
4. Report coefficient of variation (CV)

All runs are stored under unique `results/<timestamp>_<pid>_<rand>/` folders to preserve historical trends.

## Limitations

1. zigttp is FaaS-optimized and intentionally omits some APIs
2. JIT-heavy runtimes (V8, JSC) benefit from long-running warm benchmarks
3. GC metrics are not directly comparable across runtimes
4. Host OS jitter affects results - document CPU governor state
