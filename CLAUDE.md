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

All 15 microbenchmarks now work on both zigttp and Deno.

### Native Support (11 benchmarks)
Work identically on both zigttp and Deno without modification:
- arithmetic, stringOps, propertyAccess, functionCalls, jsonOps
- httpHandler, httpHandlerHeavy, stringBuild, parseInt, mathOps
- arrayOps (uses Array.indexOf, Array.includes, Array.join)

### Adapted for zigttp (4 benchmarks)
Modified to work within zigttp constraints due to recent regressions:

- **queryParsing**: Manual implementation of indexOf(needle, start) and slice(start, end)
  - Reason: zigttp String methods crash when called with multiple arguments
  - Uses manual `findChar()` and `sliceStr()` helper functions
  - Performance: ~62K ops/sec (vs 3.8M ops/sec on Deno)

- **objectCreate**: Pre-computed string array instead of concatenation
  - Reason: String concatenation `'item' + num` causes crashes in tight loops
  - Uses `const names = ['item0', 'item1', 'item2', 'item3']` lookup
  - Performance: ~2.8M ops/sec (vs 257M ops/sec on Deno)

- **dynamicProps**: Simplified from 10 to 4 properties
  - Reason: Shorter if-else chains reduce complexity and prevent crashes
  - Still tests dynamic property access patterns effectively
  - Performance: ~2.6M ops/sec (vs 293M ops/sec on Deno)

- **nestedAccess**: Reduced nesting from 4 to 2 levels
  - Reason: Deep property chains (data.user.profile.settings.count) cause crashes
  - Uses 2-level chains (data.user.count) which work reliably
  - Performance: ~1.8M ops/sec (vs 74M ops/sec on Deno)
  - **REGRESSION NOTE**: This benchmark worked on Jan 24, 2026 at 16.8M ops/sec with 4-level nesting

## Known Performance Regressions

**zigttp has regressed since Jan 24, 2026.** Benchmarks that previously worked now crash:

| Benchmark | Jan 24 Performance | Current Status | Notes |
|-----------|-------------------|----------------|-------|
| nestedAccess | 16.8M ops/sec (4 levels) | ❌ Crashes | Workaround: 1.8M ops/sec (2 levels) |
| arrayOps | 1.09M ops/sec | ❌ Crashes | Workaround: 101K ops/sec |
| objectCreate | Unknown | ❌ Crashes | Workaround: 2.8M ops/sec |
| dynamicProps | Unknown | ❌ Crashes | Workaround: 2.6M ops/sec |
| queryParsing | Unknown | ❌ Crashes | Workaround: 62K ops/sec |

**Root cause**: zigttp commits after Jan 24 introduced bugs in:
- Multi-parameter String methods (indexOf, slice)
- String concatenation in tight loops
- Deep object property chains (3-4 levels)
- Long if-else chains

**Action items**:
1. File issue with zigttp team documenting regressions
2. Identify which specific zigttp commit introduced the bugs
3. Wait for fixes before re-enabling original benchmark versions

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

## Prerequisites

- `hey` CLI for HTTP load testing
- Deno installed globally
- zigttp built from `../zigttp` with `zig build -Doptimize=ReleaseFast`
