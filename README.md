# zigttp Benchmark Suite

Comprehensive performance comparison of zigttp against Node.js, Deno, and Bun.

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

## Prerequisites

- Node.js (tested with v22.21.0)
- Deno (tested with v2.6.4)
- Bun (optional, install with `curl -fsSL https://bun.sh/install | bash`)
- hey (HTTP load testing tool)
- zigttp built with release optimizations

Build zigttp:
```bash
cd ../zigttp
zig build -Doptimize=ReleaseFast
```

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
