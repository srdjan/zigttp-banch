#!/bin/bash
# Run microbenchmarks and generate a combined ops/sec table

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"

mkdir -p "$RESULTS_DIR"

echo "Microbenchmark Suite (table)"
echo "Results: $RESULTS_DIR"
echo ""

"$SCRIPT_DIR/run_microbench.sh" "$RESULTS_DIR" "$RUNTIME"

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
