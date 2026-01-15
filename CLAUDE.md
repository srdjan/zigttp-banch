# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Benchmark suite comparing zigttp (a Zig-based JavaScript runtime optimized for FaaS/serverless) against Deno. Measures HTTP throughput, JS execution speed, cold start times, and memory usage.

zigttp is built from sibling directory `../zigttp` and produces minimal-API synchronous-only handlers.

## Commands

```bash
# Quick validation (1 connection, short duration)
./scripts/run.sh quick

# Full benchmark suite (HTTP + microbench + coldstart + memory)
./scripts/run.sh full

# Individual benchmark types
./scripts/run.sh http [runtime]        # HTTP throughput
./scripts/run.sh microbench [runtime]  # JS execution speed
./scripts/run.sh coldstart [runtime]   # Cold start times
./scripts/run.sh memory [runtime]      # Memory profiling

# Combined ops/sec table output
./scripts/run_microbench_table.sh all

# Flamegraph for zigttp
./scripts/run_flamegraph.sh

# Generate analysis report from results
python3 analysis/analyze.py --results-dir results/<timestamp> --output report.md
```

Runtime argument is optional: `deno` or `zigttp`.

### Environment Variables for Tuning

```bash
BENCH_FILTER=httpHandlerHeavy                  # Run only specific benchmarks (comma-separated)
BENCH_WARMUP_ITERATIONS=5                      # Reduce warmup for smoke tests
BENCH_MEASURED_ITERATIONS=8                    # Fewer measured samples
BENCH_HTTP_HANDLER_HEAVY_ITERATIONS=200        # Tune inner loop iterations
PROFILE_SECONDS=20                             # Flamegraph sampling window
```

## Architecture

**scripts/**: Bash orchestration layer. `run.sh` is main entry point that dispatches to `run_http.sh`, `run_microbench.sh`, `run_coldstart.sh`, `run_memory.sh`.

**handlers/**: HTTP server implementations per runtime. Each implements identical endpoints (`/api/health`, `/api/echo`, `/api/greet/:name`). zigttp handler at `handlers/zigttp/handler.js` is synchronous-only with minimal API surface.

**microbench/**: JavaScript benchmark suite. `runner.js` provides timing harness with runtime detection for high-res timers. `suite.js` orchestrates benchmark execution. Individual benchmarks in `benchmarks/` directory.

**results/**: Output directory (gitignored). Each run creates `YYYYMMDD_HHMMSS_PID_RAND/` subdirectory containing JSON results and generated `report.md`.

## Key Constraints

zigttp handlers are synchronous-only: no Promises, no async/await, no module imports. Test both warm (server persists) and cold (fresh spawn) modes separately.

Results directories preserve historical runs and never overwrite. When comparing runs, ensure `system_info.json` matches.

## Prerequisites

- `hey` CLI for HTTP load testing
- Deno installed globally
- zigttp built from `../zigttp` with `zig build -Doptimize=ReleaseFast`
