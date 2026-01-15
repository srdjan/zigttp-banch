# zigttp Benchmark Suite

Comprehensive performance comparison of [zigttp](https://github.com/srdjan/zigttp) against Deno.

## Quick Start

```bash
# Run quick validation (1 connection, short duration)
./scripts/run.sh quick

# Run full benchmark suite
./scripts/run.sh full

# Run specific benchmark type
./scripts/run.sh http     # HTTP throughput
./scripts/run.sh microbench  # JS execution speed
./scripts/run.sh coldstart   # Cold start times
./scripts/run.sh memory      # Memory profiling
```

## Running Benchmarks

```bash
# Run a specific runtime only (deno|zigttp)
./scripts/run.sh microbench deno
./scripts/run.sh http zigttp

# Run microbenchmarks (results auto-saved under ./results)
./scripts/run_microbench.sh all

# Run microbenchmarks and emit a combined ops/sec table
./scripts/run_microbench_table.sh all
```

### Historical runs

- Every run is stored under `results/<timestamp>_<pid>_<rand>/` and never overwrites previous output.
- If you set `RESULTS_DIR`, a new unique directory will still be created if the target already exists and is non-empty.

### Microbenchmark filtering and tuning

You can run a subset of the microbench suite and tweak iteration counts via env vars:

```bash
# Run only httpHandlerHeavy with fewer inner iterations
BENCH_FILTER=httpHandlerHeavy \
BENCH_HTTP_HANDLER_HEAVY_ITERATIONS=200 \
./scripts/run_microbench.sh all

# Reduce warmup and measured iterations for faster smoke tests
BENCH_WARMUP_ITERATIONS=5 \
BENCH_MEASURED_ITERATIONS=8 \
BENCH_WARMUP_MS=50 \
BENCH_MAX_MEASURED_TOTAL_MS=500 \
./scripts/run_microbench.sh all
```

### Flamegraph (zigttp)

Generate a flamegraph for the zigttp microbench (defaults to `httpHandlerHeavy`):

```bash
./scripts/run_flamegraph.sh

# Longer sampling window / heavier workload
PROFILE_SECONDS=20 \
BENCH_HTTP_HANDLER_HEAVY_ITERATIONS=4000 \
./scripts/run_flamegraph.sh
```

The SVG is saved under `results/<timestamp>/flamegraph.svg`.

## Prerequisites

- Deno (tested with v2.6.4)
- hey (HTTP load testing tool)
- zigttp built with release optimizations

Build zigttp:
```bash
cd ../zigttp
zig build -Doptimize=ReleaseFast
```
This also produces `zig-out/bin/zigttp-bench` used by the microbenchmark runner.

## Project Structure

```
.
├── README.md           # This file
├── methodology.md      # Detailed test methodology
├── versions.json       # Pinned runtime versions
├── features/           # Feature comparison matrix
├── handlers/           # HTTP handlers per runtime
├── microbench/         # JavaScript microbenchmarks
├── scripts/            # Benchmark runner scripts
├── analysis/           # Statistical analysis tools
└── results/            # Benchmark output (gitignored)
```

## Benchmark Categories

### HTTP Throughput
Measures requests/second and latency percentiles for standard endpoints:
- `/api/health` - Health check (minimal response)
- `/api/echo` - Echo request details
- `/api/greet/:name` - Path parameter handling

### JavaScript Execution Speed
Microbenchmarks testing core JS performance:
- Integer arithmetic
- String operations
- Object creation
- Property access
- Function calls
- JSON serialization
- HTTP handler simulation
- HTTP handler simulation (heavy)

### Cold Start
Time from process spawn to first successful HTTP response.
100 iterations per runtime for statistical significance.

### Memory Usage
- Baseline RSS after startup
- Peak and average RSS under load

## Output

Results are saved to `results/<timestamp>/` with:
- `system_info.json` - Test environment details
- `http_*.json` - HTTP benchmark results
- `microbench_*.json` - JS execution results
- `coldstart_*.json` - Cold start measurements
- `memory_*.json` - Memory profiles
- `report.md` - Generated analysis report

Each run gets a unique results folder to preserve historical trends.

## Analysis

```bash
# Generate report from existing results
python3 analysis/analyze.py --results-dir results/<timestamp> --output report.md

# Install Python dependencies for full statistical analysis
pip install -r analysis/requirements.txt
```

## Methodology

See [methodology.md](methodology.md) for detailed documentation of:
- Test protocols
- Warmup procedures
- Statistical methods
- Known limitations
