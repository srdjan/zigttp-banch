# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Benchmark suite comparing zigttp (a Zig-based JavaScript runtime optimized for FaaS/serverless) against Deno. Measures HTTP throughput, JS execution speed, cold start times, and memory usage.

zigttp is built from sibling directory `../zigttp` and produces minimal-API synchronous-only handlers.

## Commands

```bash
# Quick validation (1 connection, short duration)
deno run -A bench.ts quick [runtime]

# Full benchmark suite (HTTP + microbench + coldstart + memory)
deno run -A bench.ts full [runtime]

# Individual benchmark types
deno run -A bench.ts http [runtime]       # HTTP throughput
deno run -A bench.ts micro [runtime]      # JS execution speed
deno run -A bench.ts cold [runtime]       # Cold start times
deno run -A bench.ts memory [runtime]     # Memory profiling

# With options
deno run -A bench.ts http zigttp --connections=20
deno run -A bench.ts micro zigttp --filter=arithmetic,stringOps
deno run -A bench.ts cold zigttp --iterations=50

# Report generation
deno run -A bench.ts report results/<timestamp>
deno run -A bench.ts compare results/<timestamp>

# Flamegraph for zigttp
./scripts/run_flamegraph.sh
```

Runtime argument is optional: `deno`, `zigttp`, or `all` (default).

### CLI Options

- `--connections=N`: Number of connections for HTTP benchmarks (default: 10)
- `--filter=name1,name2`: Filter microbenchmarks by name
- `--iterations=N`: Number of iterations for cold start (default: 100)

## Architecture

**bench.ts**: Main CLI entry point that dispatches to benchmark modules.

**lib/**: Deno TypeScript modules for benchmark orchestration:
- `runtime.ts`: Runtime detection and binary paths
- `ports.ts`: Port management utilities
- `server.ts`: Server lifecycle management
- `results.ts`: Results directory and system info
- `http.ts`: HTTP benchmark runner
- `coldstart.ts`: Cold start benchmarks
- `memory.ts`: Memory profiling
- `microbench.ts`: Microbenchmark runner
- `analyze.ts`: Report generation

**handlers/**: HTTP server implementations per runtime. Each implements identical endpoints (`/api/health`, `/api/echo`, `/api/greet/:name`). zigttp handler at `handlers/zigttp/handler.js` is synchronous-only with minimal API surface.

**microbench/**: JavaScript benchmark suite. `runner.js` provides timing harness with runtime detection for high-res timers. `suite.js` orchestrates benchmark execution. Individual benchmarks in `benchmarks/` directory.

**results/**: Output directory (gitignored). Each run creates `YYYYMMDD_HHMMSS_PID_RAND/` subdirectory containing JSON results and generated `report.md`.

**baselines/deno/**: Saved Deno benchmark results for comparison (quick and full runs).

## Key Constraints

zigttp handlers are synchronous-only: no Promises, no async/await, no module imports. Test both warm (server persists) and cold (fresh spawn) modes separately.

Results directories preserve historical runs and never overwrite. When comparing runs, ensure `system_info.json` matches.

## zigttp Language Limitations

The benchmark code must be compatible with zigttp's restricted JavaScript subset:

- **No `break` or `continue` statements**: Use a `done` flag pattern instead:
  ```javascript
  let done = false;
  for (let _ of range(10)) {
      if (!done) {
          // ... work ...
          if (condition) {
              done = true;
          }
      }
  }
  ```
- **No `while` loops**: Use `for (let _ of range(n))` with a done flag
- **No C-style `for` loops**: Use `for (let i of range(n))` instead
- **No `var` keyword**: Use `let` or `const`
- **No function expressions**: Use arrow functions `() => {}` or function declarations
- **No `Function()` constructor**: The `range()` builtin is provided globally
- **Array index assignment only works for index 0**: Use accumulation instead of array storage
- **No `Array.push()`**: Build arrays differently or use accumulation

## Known zigttp Runtime Issues

**Function execution caching bug**: After exactly 3 executions of the same function with 50000+ inner loop iterations, zigttp starts returning incorrect results (returns the seed parameter instead of computed value) and timing drops to near-zero. This affects microbenchmark accuracy. The issue persists regardless of JIT settings and appears to be an interpreter-level caching/optimization bug in the zigttp runtime.

**JIT disabled for microbenchmarks**: Due to the caching bug above, microbenchmarks run with `ZTS_JIT_THRESHOLD=999999` to effectively disable JIT.

## Baseline Comparison Workflow

**Deno baselines are saved in `baselines/deno/`** (quick and full runs from 2026-01-26).

When running benchmarks:
1. Only run zigttp benchmarks: `deno run -A bench.ts full zigttp` or `deno run -A bench.ts quick zigttp`
2. Compare results against saved Deno baseline using `deno run -A bench.ts compare results/<dir>`
3. Do NOT re-run Deno benchmarks unless explicitly requested

This avoids redundant Deno runs and ensures consistent baseline comparison.

## Prerequisites

- `hey` CLI for HTTP load testing
- Deno installed globally
- zigttp built from `../zigttp` with `zig build -Doptimize=ReleaseFast`
