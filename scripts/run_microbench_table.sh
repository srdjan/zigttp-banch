#!/bin/bash
# Run microbenchmarks and generate a combined ops/sec table

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_BASE="$PROJECT_DIR/results"
RUNTIME="${1:-all}"

if [[ -z "${RESULTS_DIR:-}" ]]; then
    RESULTS_DIR="$RESULTS_BASE/$(date +%Y%m%d_%H%M%S)_$$_$RANDOM"
else
    if [[ "$RESULTS_DIR" = /* ]]; then
        if [[ "$RESULTS_DIR" == "$RESULTS_BASE"* ]]; then
            RESULTS_DIR="$RESULTS_DIR"
        else
            RESULTS_DIR="$RESULTS_BASE/$(basename "$RESULTS_DIR")"
        fi
    else
        if [[ "$RESULTS_DIR" == results/* ]]; then
            RESULTS_DIR="$PROJECT_DIR/$RESULTS_DIR"
        else
            RESULTS_DIR="$RESULTS_BASE/$RESULTS_DIR"
        fi
    fi
fi

ensure_unique_results_dir() {
    if [[ -d "$RESULTS_DIR" ]]; then
        if [[ -n "$(ls -A "$RESULTS_DIR" 2>/dev/null)" ]]; then
            RESULTS_DIR="$RESULTS_BASE/$(date +%Y%m%d_%H%M%S)_$$_$RANDOM"
        fi
    fi
}

ensure_unique_results_dir
mkdir -p "$RESULTS_DIR"

echo "Microbenchmark Suite (table)"
echo "Results: $RESULTS_DIR"
echo ""

RESULTS_DIR="$RESULTS_DIR" "$SCRIPT_DIR/run_microbench.sh" "$RUNTIME"

TABLE_PATH="$RESULTS_DIR/microbench_table.md"

python3 - <<PY > "$TABLE_PATH"
import json
from pathlib import Path

results_dir = Path("$RESULTS_DIR")

data = {}
bench_names = set()

for path in results_dir.glob("microbench_*.json"):
    runtime = path.stem.replace("microbench_", "")
    content = json.loads(path.read_text())
    benches = content.get("benchmarks", {})
    data[runtime] = benches
    bench_names.update(benches.keys())

runtimes = sorted(data.keys())

def fmt(value):
    if value is None:
        return "-"
    return f"{value:,.2f}"

lines = []
lines.append("| Benchmark | " + " | ".join(runtimes) + " |")
lines.append("|" + "|".join(["---"] * (len(runtimes) + 1)) + "|")

for bench in sorted(bench_names):
    row = [bench]
    for runtime in runtimes:
        ops = data.get(runtime, {}).get(bench, {}).get("ops_per_sec")
        row.append(fmt(ops))
    lines.append("| " + " | ".join(row) + " |")

print("\n".join(lines))
PY

echo ""
echo "Combined table written to: $TABLE_PATH"
echo ""
cat "$TABLE_PATH"
