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
- `utils.ts`: Shared utilities (sleep, stats, timestamps)

**handlers/**: HTTP server implementations per runtime. Both implement `/api/health`, `/api/echo`, and `/api/greet/:name`, though with behavioral differences (see "Known Handler Differences" below). zigttp handler at `handlers/zigttp/handler.js` is synchronous-only with minimal API surface.

**microbench/**: JavaScript benchmark suite. `runner.js` provides timing harness with runtime detection for high-res timers. `suite.js` orchestrates benchmark execution. Individual benchmarks in `benchmarks/` directory.

**results/**: Output directory (gitignored). Each run creates `YYYYMMDD_HHMMSS_PID_RAND/` subdirectory containing JSON results and generated `report.md`.

**baselines/deno/**: Saved Deno benchmark results for comparison (quick and full runs).

## Known Handler Differences

The handlers are not fully identical across runtimes. These affect benchmark comparability:

- `/api/echo`: zigttp returns a fixed `{ok: true}` stub; Deno does full request reflection (method, headers, body)
- `/api/greet/:name`: zigttp uses `rawJson` bypassing JSON serialization overhead; Deno uses standard `JSON.stringify`
- `/api/health`: zigttp hardcodes `timestamp: 0`; Deno uses `Date.now()`

These differences are intentional trade-offs reflecting zigttp's minimal API surface. Fixing them would change benchmark results and should be a separate decision.

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

## Microbenchmark Compatibility

All 17 microbenchmarks now work on both zigttp and Deno.

### Native Support (16 benchmarks)
Work identically on both zigttp and Deno without modification:
- arithmetic, stringOps, propertyAccess, functionCalls, jsonOps
- httpHandler, httpHandlerHeavy, stringBuild, parseInt, mathOps
- arrayOps, nestedAccess, queryParsing, objectCreate
- monoProperty (read-only property access for measuring monomorphic optimization)
- monoPropertyWrite (write-heavy property access)

### Adapted for zigttp (1 benchmark)

- **dynamicProps**: Reduced from 10 to 8 if-else branches
  - Reason: Functions with 9+ if-else branches crash when called 150+ times
  - Root cause: JIT bug in zigttp - exact threshold is 9 branches
  - Performance: ~22M ops/sec with 8 branches (vs 293M ops/sec on Deno)
  - Status: Workaround in place (8 branches, 80% of original coverage)

## Regression Status (Updated 2026-02-04)

Most regressions documented on Feb 1 have been **fixed** by zigttp commit `370ab5b` (Feb 2) which implemented real string builtins.

| Benchmark | Previous Status | Current Status | Performance |
|-----------|-----------------|----------------|-------------|
| nestedAccess | Workaround (2 levels) | ✅ Fixed | 10.1M ops/sec (4 levels restored) |
| queryParsing | Workaround (manual indexOf) | ✅ Fixed | 3.9M ops/sec (native methods) |
| objectCreate | Workaround | ✅ Fixed | 16.2M ops/sec |
| dynamicProps | Workaround (4 branches) | ⚠️ Improved to 8 | 22M ops/sec (JIT bug at 9+ branches) |

**Remaining issue**: dynamicProps crashes with 9+ if-else branches when called 150+ times. This is a JIT compilation bug in zigttp. Workaround uses 8 branches (80% coverage of original 10)

## Baseline Comparison Workflow

**Deno baselines are saved in `baselines/deno/`** (quick and full runs from 2026-01-26).

When running benchmarks:
1. Only run zigttp benchmarks: `deno run -A bench.ts full zigttp` or `deno run -A bench.ts quick zigttp`
2. Compare results against saved Deno baseline using `deno run -A bench.ts compare results/<dir>`
3. Do NOT re-run Deno benchmarks unless explicitly requested

This avoids redundant Deno runs and ensures consistent baseline comparison.

## Cold Start Optimization

### Optimized Build (Recommended for Production)

Build zigttp with embedded bytecode precompilation for 16% faster cold starts:

```bash
./scripts/build_optimized.sh
```

This builds zigttp with `-Dhandler=handlers/zigttp/handler.js`, which:
- Precompiles handler to bytecode at build time (1,968 bytes → 895 bytes)
- Eliminates runtime parsing and compilation (saves ~13ms)
- Reduces cold start from 83ms to 71ms
- No binary size increase
- No functionality changes

### Baseline Build (Development/Comparison)

```bash
./scripts/build_baseline.sh
```

This builds without embedded bytecode for comparison testing.

### Optimization Results

**Proven effective** (2026-01-31 analysis):
- Embedded bytecode: **-13ms (16% faster)** - 83ms → 71ms
- Memory footprint: 4.0 MB → 3.8 MB

**Tested but ineffective**:
- Reducing prewarm count: 0ms savings (prewarm runs in parallel)
- Stripping debug symbols: 0ms savings (dyld overhead unaffected)
- Reducing pool size: <2ms variance across 1-28 workers

See `results/optimization_results.md` for detailed analysis and `results/coldstart_analysis.md` for profiling data.

## NaN-boxing Performance Analysis

After NaN-boxing was introduced for float optimization, an analysis was performed to understand property access performance (2026-02-04).

### Key Findings

| Benchmark | zigttp ops/sec | Notes |
|-----------|---------------|-------|
| monoProperty (read-only) | 72M | Exceeds pre-NaN-boxing 62M target |
| monoPropertyWrite | 45M | Write-heavy workload |
| propertyAccess (mixed) | 37M | 5 reads + 1 write per iteration |

The monomorphic read path is **fully optimized** and exceeds targets. The original `propertyAccess` benchmark includes writes which have inherent overhead (2 stack pops, store operations).

### Trade-off Summary

- mathOps: 41.6x improvement (5M -> 208M ops/sec)
- Monomorphic property reads: Better than pre-NaN-boxing
- Mixed read/write: Acceptable overhead

No further optimization needed for pointer extraction. See `results/nan_boxing_pointer_analysis.md` for detailed analysis.

## Prerequisites

- `hey` CLI for HTTP load testing
- Deno installed globally
- zigttp built from `../zigttp` with `zig build -Doptimize=ReleaseFast`
