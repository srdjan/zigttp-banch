#!/bin/bash
# Cold start benchmark runner
# Measures time from process spawn to first successful response

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"
ITERATIONS="${3:-100}"

PORT=8080

mkdir -p "$RESULTS_DIR"

# Python helper for microsecond timing
measure_coldstart() {
    local cmd="$1"
    python3 <<EOF
import subprocess
import time
import socket

def check_port(port, timeout=0.01):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect(('127.0.0.1', port))
            return True
    except:
        return False

def measure():
    start = time.perf_counter_ns()

    proc = subprocess.Popen(
        $cmd,
        shell=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    # Poll until server responds
    max_attempts = 1000  # 10 seconds max
    for _ in range(max_attempts):
        if check_port($PORT):
            end = time.perf_counter_ns()
            proc.terminate()
            proc.wait()
            return (end - start) // 1000  # Return microseconds
        time.sleep(0.01)

    proc.terminate()
    proc.wait()
    return -1

print(measure())
EOF
}

# Run cold start measurements
run_coldstart() {
    local runtime=$1
    local cmd=$2
    local results=()

    echo "=== Cold Start: $runtime ($ITERATIONS iterations) ==="

    for i in $(seq 1 $ITERATIONS); do
        local us=$(measure_coldstart "$cmd")
        if [[ "$us" -gt 0 ]]; then
            results+=("$us")
        fi
        if (( i % 10 == 0 )); then
            echo "  Completed $i/$ITERATIONS"
        fi
    done

    # Calculate statistics with Python
    local stats=$(python3 <<EOF
import json
data = [${results[*]}]
if data:
    data.sort()
    n = len(data)
    mean = sum(data) / n
    median = data[n // 2]
    p95 = data[int(n * 0.95)]
    p99 = data[int(n * 0.99)]
    print(json.dumps({
        "mean_us": int(mean),
        "median_us": median,
        "p95_us": p95,
        "p99_us": p99,
        "min_us": data[0],
        "max_us": data[-1],
        "samples": n
    }))
else:
    print('{}')
EOF
)

    # Write results
    cat > "$RESULTS_DIR/coldstart_${runtime}.json" <<EOF
{
    "type": "cold_start",
    "runtime": "$runtime",
    "iterations": $ITERATIONS,
    "metrics": $stats,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo "  Results: $stats"
    echo ""
}

echo "Cold Start Benchmark Suite"
echo "Results: $RESULTS_DIR"
echo ""

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "node" ]]; then
    run_coldstart "node" "\"PORT=$PORT node $PROJECT_DIR/handlers/node/server.js\""
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "deno" ]]; then
    run_coldstart "deno" "\"PORT=$PORT deno run --allow-net --allow-env $PROJECT_DIR/handlers/deno/server.ts\""
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "bun" ]]; then
    if command -v bun &> /dev/null; then
        run_coldstart "bun" "\"PORT=$PORT bun run $PROJECT_DIR/handlers/bun/server.ts\""
    else
        echo "Bun not installed, skipping"
    fi
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "zigttp" ]]; then
    ZIGTTP_BIN="$PROJECT_DIR/../zigttp/zig-out/bin/zigttp-server"
    if [[ -x "$ZIGTTP_BIN" ]]; then
        run_coldstart "zigttp" "\"$ZIGTTP_BIN -p $PORT -q $PROJECT_DIR/handlers/zigttp/handler.js\""
    else
        echo "zigttp not built, skipping"
    fi
fi

echo "=== Cold Start Benchmarks Complete ==="
