# zigttp Benchmark Suite

Comprehensive performance comparison of
[zigttp](https://github.com/srdjan/zigttp) against Deno.

## Quick Start

```bash
# Run quick validation (1 connection, short duration)
deno run -A bench.ts quick

# Run full benchmark suite (HTTP + microbench + coldstart + memory)
deno run -A bench.ts full

# Run specific benchmark type
deno run -A bench.ts http     # HTTP throughput
deno run -A bench.ts micro    # JS execution speed
deno run -A bench.ts cold     # Cold start times
deno run -A bench.ts memory   # Memory profiling
```

Runtime argument is optional: `deno`, `zigttp`, or `all` (default). HTTP
benchmarks also support mode selection:
`--http-mode=parity|implementation|floor` (default: `parity`).

## Running Benchmarks

```bash
# Run a specific runtime only
deno run -A bench.ts micro deno
deno run -A bench.ts http zigttp

# With options
deno run -A bench.ts http zigttp --connections=20 --http-mode=parity
deno run -A bench.ts http zigttp --http-mode=parity --zigttp-pool=16
deno run -A bench.ts http all --http-mode=floor --pool-sweep=8,12,16,28
deno run -A bench.ts micro zigttp --filter=arithmetic,stringOps
deno run -A bench.ts cold zigttp --iterations=50

# Report generation from existing results
deno run -A bench.ts report results/<timestamp>
deno run -A bench.ts compare results/<timestamp>
```

### Historical runs

Every run is stored under `results/<timestamp>_<pid>_<rand>/` and never
overwrites previous output.

### Flamegraph (zigttp)

Generate a flamegraph for the zigttp microbench (defaults to
`httpHandlerHeavy`):

```bash
./scripts/run_flamegraph.sh

# Longer sampling window / heavier workload
PROFILE_SECONDS=20 \
BENCH_HTTP_HANDLER_HEAVY_ITERATIONS=4000 \
./scripts/run_flamegraph.sh
```

The SVG is saved under `results/<timestamp>/flamegraph.svg`.

## Cold Start Optimization

zigttp cold starts can be reduced by 16% (83ms to 71ms) using embedded bytecode
precompilation:

```bash
./scripts/build_optimized.sh
```

See `results/optimization_results.md` and `results/coldstart_analysis.md` for
detailed analysis and profiling data.

## Prerequisites

- Deno
- hey (HTTP load testing tool)
- zigttp built with release optimizations

Build zigttp:

```bash
# Baseline build (runtime handler loading)
./scripts/build_baseline.sh

# Optimized build (embedded bytecode, 16% faster cold starts)
./scripts/build_optimized.sh
```

## Project Structure

```
.
├── bench.ts            # Main CLI entry point
├── lib/                # Deno TypeScript modules for benchmark orchestration
│   ├── runtime.ts      # Runtime detection and binary paths
│   ├── ports.ts        # Port management utilities
│   ├── server.ts       # Server lifecycle management
│   ├── results.ts      # Results directory and system info
│   ├── http.ts         # HTTP benchmark runner
│   ├── coldstart.ts    # Cold start benchmarks
│   ├── memory.ts       # Memory profiling
│   ├── microbench.ts   # Microbenchmark runner
│   ├── analyze.ts      # Report generation
│   └── utils.ts        # Shared utilities
├── handlers/           # HTTP handlers per runtime
├── microbench/         # JavaScript microbenchmarks
│   ├── runner.js       # Timing harness with runtime detection
│   ├── suite.js        # Benchmark orchestration
│   └── benchmarks/     # Individual benchmark files
├── baselines/          # Saved Deno baseline results for comparison
├── scripts/            # Build, profiling, and analysis scripts
└── results/            # Benchmark output (gitignored)
```

## Benchmark Categories

### HTTP Throughput

Measures requests/second and latency percentiles for standard endpoints:

- `/api/noop` - Minimal static JSON response (fixed-overhead floor test)
- `/api/health` - Health check (minimal response)
- `/api/greet/:name` - Path parameter handling
- `/api/compute` - CPU-bound handler

### JavaScript Execution Speed

17 microbenchmarks testing core JS performance:

- arithmetic, stringOps, objectCreate, propertyAccess, functionCalls
- jsonOps, httpHandler, httpHandlerHeavy, stringBuild, dynamicProps
- arrayOps, nestedAccess, queryParsing, parseInt, mathOps, monoProperty,
  monoPropertyWrite

### Cold Start

Time from process spawn to first successful HTTP response.

- Default: 100 iterations per runtime for statistical significance
- Baseline zigttp: ~83ms (runtime handler parsing)
- Optimized zigttp: ~71ms (embedded bytecode, 16% faster)
- Profiling: `./scripts/profile_coldstart.sh`
- Analysis: `./scripts/analyze_coldstart.sh` (add `--embedded` for bytecode
  build)

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

## Methodology

See [methodology.md](methodology.md) for test protocols, warmup procedures, and
statistical methods.
