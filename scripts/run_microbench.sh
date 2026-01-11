#!/bin/bash
# Microbenchmark runner
# Runs JS execution benchmarks across all runtimes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"

MICROBENCH_DIR="$PROJECT_DIR/microbench"

mkdir -p "$RESULTS_DIR"

# Create combined benchmark script that works across runtimes
BENCH_SCRIPT="$(cat \
    "$MICROBENCH_DIR/runner.js" \
    "$MICROBENCH_DIR/benchmarks/"*.js \
    "$MICROBENCH_DIR/suite.js" \
)"

run_microbench() {
    local runtime=$1
    local cmd=$2

    echo "=== Microbenchmarks: $runtime ==="

    local output=$(echo "$BENCH_SCRIPT" | eval "$cmd" 2>/dev/null)

    if [[ -n "$output" ]]; then
        cat > "$RESULTS_DIR/microbench_${runtime}.json" <<EOF
{
    "type": "microbenchmark",
    "runtime": "$runtime",
    "benchmarks": $output,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
        echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for name, result in data.items():
    ops = result.get('ops_per_sec', 0)
    print(f\"  {name}: {ops:,.2f} ops/sec\")
"
    else
        echo "  Failed to run benchmarks"
    fi
    echo ""
}

run_zigttp_microbench() {
    local runtime="zigttp"
    local zigttp_bin="$PROJECT_DIR/../zigttp/zig-out/bin/zigttp-bench"

    echo "=== Microbenchmarks: $runtime ==="

    if [[ ! -x "$zigttp_bin" ]]; then
        echo "  zigttp not built, skipping (run: cd ../zigttp && zig build bench)"
        echo ""
        return
    fi

    set +e
    local output
    output=$("$zigttp_bin" --json --quiet 2>/dev/null | python3 -c '
import json
import sys

name_map = {
    "intArithmetic": "arithmetic",
    "stringOps": "stringOps",
    "objectCreate": "objectCreate",
    "propertyAccess": "propertyAccess",
    "functionCalls": "functionCalls",
    "jsonOps": "jsonOps",
}
results = {}

data = json.load(sys.stdin)
benchmarks = data.get("benchmarks", [])

for bench in benchmarks:
    raw_name = bench.get("name")
    if not raw_name:
        continue
    mapped_name = name_map.get(raw_name, raw_name)
    if mapped_name in results:
        continue
    time_ms = float(bench.get("time_ms", 0))
    ops = float(bench.get("ops_per_sec", 0))
    entry = {
        "name": mapped_name,
        "ops_per_sec": ops,
        "total_ms": time_ms,
        "source_bench": raw_name,
    }
    iterations = bench.get("iterations")
    if iterations:
        entry["inner_iterations"] = iterations
    results[mapped_name] = entry

print(json.dumps(results, indent=2))
')
    local status=$?
    set -e

    if [[ $status -ne 0 && -z "$output" ]]; then
        echo "  Failed to run zigttp-bench"
        echo ""
        return
    fi

    if [[ -n "$output" ]]; then
        cat > "$RESULTS_DIR/microbench_${runtime}.json" <<EOF
{
    "type": "microbenchmark",
    "runtime": "$runtime",
    "benchmarks": $output,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "source": "zigttp-bench"
}
EOF
        echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for name, result in data.items():
    ops = result.get('ops_per_sec', 0)
    print(f\"  {name}: {ops:,.2f} ops/sec\")
"
    else
        echo "  Failed to parse zigttp-bench output"
    fi
    echo ""
}

echo "Microbenchmark Suite"
echo "Results: $RESULTS_DIR"
echo ""

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "node" ]]; then
    run_microbench "node" "node"
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "deno" ]]; then
    run_microbench "deno" "deno run -"
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "bun" ]]; then
    BUN_BIN=""
    if command -v bun &> /dev/null; then
        BUN_BIN="$(command -v bun)"
    elif [[ -n "${BUN_INSTALL:-}" && -x "$BUN_INSTALL/bin/bun" ]]; then
        BUN_BIN="$BUN_INSTALL/bin/bun"
    elif [[ -x "$HOME/.bun/bin/bun" ]]; then
        BUN_BIN="$HOME/.bun/bin/bun"
    fi

    if [[ -n "$BUN_BIN" ]]; then
        run_microbench "bun" "\"$BUN_BIN\" run -"
    else
        echo "Bun not installed, skipping"
    fi
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "zigttp" ]]; then
    run_zigttp_microbench
fi

echo "=== Microbenchmarks Complete ==="
