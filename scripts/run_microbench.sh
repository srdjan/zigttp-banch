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
BENCH_SCRIPT=$(cat <<'ENDSCRIPT'
// Combined microbenchmark runner

const WARMUP_ITERATIONS = 10;
const MEASURED_ITERATIONS = 30;

function now() {
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    return Date.now();
}

function benchmark(name, fn, innerIterations) {
    // Warmup
    for (let i = 0; i < WARMUP_ITERATIONS; i++) { fn(); }

    // Measure
    const results = [];
    for (let i = 0; i < MEASURED_ITERATIONS; i++) {
        const start = now();
        fn();
        results.push(now() - start);
    }

    const totalMs = results.reduce((a, b) => a + b, 0);
    const totalOps = innerIterations * MEASURED_ITERATIONS;
    return {
        name: name,
        total_ms: totalMs,
        ns_per_op: (totalMs * 1000000) / totalOps,
        ops_per_sec: Math.floor(totalOps / (totalMs / 1000))
    };
}

// Benchmarks
const ITERATIONS = 50000;

function runArithmetic() {
    let sum = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        sum = (sum + i) % 1000000;
        sum = (sum - (i % 1000) + 1000000) % 1000000;
        sum = (sum * 2) % 1000000;
        sum = (sum >> 1);
    }
    return sum;
}

function runStringOps() {
    const str = 'The quick brown fox jumps over the lazy dog';
    let count = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        count = (count + str.indexOf('fox')) % 1000000;
        count = (count + str.length) % 1000000;
    }
    return count;
}

function runObjectCreate() {
    let objects = [];
    for (let i = 0; i < ITERATIONS; i++) {
        objects.push({ id: i, name: 'item' });
        if (objects.length > 100) { objects = []; }
    }
    return objects.length;
}

function runPropertyAccess() {
    const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    let sum = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        sum = (sum + obj.a + obj.b + obj.c + obj.d + obj.e) % 1000000;
        obj.a = i % 100;
    }
    return sum;
}

function runFunctionCalls() {
    function add(a, b) { return (a + b) % 1000000; }
    function compute(x, y) { return add(x, y); }
    let result = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        result = compute(i % 1000, result);
    }
    return result;
}

function runJsonOps() {
    const obj = { users: [{ id: 1 }, { id: 2 }] };
    let count = 0;
    const JSON_ITERATIONS = 5000;
    for (let i = 0; i < JSON_ITERATIONS; i++) {
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        count = (count + parsed.users.length) % 1000000;
    }
    return count;
}

// Run all benchmarks
const results = {
    arithmetic: benchmark('arithmetic', runArithmetic, ITERATIONS),
    stringOps: benchmark('stringOps', runStringOps, ITERATIONS),
    objectCreate: benchmark('objectCreate', runObjectCreate, ITERATIONS),
    propertyAccess: benchmark('propertyAccess', runPropertyAccess, ITERATIONS),
    functionCalls: benchmark('functionCalls', runFunctionCalls, ITERATIONS),
    jsonOps: benchmark('jsonOps', runJsonOps, 5000)
};

console.log(JSON.stringify(results, null, 2));
ENDSCRIPT
)

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
    print(f\"  {name}: {result['ops_per_sec']:,} ops/sec\")
"
    else
        echo "  Failed to run benchmarks"
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
    if command -v bun &> /dev/null; then
        run_microbench "bun" "bun run -"
    else
        echo "Bun not installed, skipping"
    fi
fi

echo "=== Microbenchmarks Complete ==="
