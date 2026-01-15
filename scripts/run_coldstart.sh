#!/bin/bash
# Cold start benchmark runner
# Measures time from process spawn to first successful response

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"
ITERATIONS="${3:-100}"

# Unique ports per runtime
PORT_DENO=8080
PORT_ZIGTTP=8081
PORT=""  # Set per-runtime

# Track status
STATUS_DENO=""
STATUS_ZIGTTP=""
COOLDOWN_SECS=2

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

runtimes_to_run=""
runtime_count=0

if [ "$RUNTIME" = "all" ] || [ "$RUNTIME" = "deno" ]; then
    runtimes_to_run="deno"
    runtime_count=$((runtime_count + 1))
fi

if [ "$RUNTIME" = "all" ] || [ "$RUNTIME" = "zigttp" ]; then
    ZIGTTP_BIN="$PROJECT_DIR/../zigttp/zig-out/bin/zigttp-server"
    if [ -x "$ZIGTTP_BIN" ]; then
        if [ -n "$runtimes_to_run" ]; then
            runtimes_to_run="$runtimes_to_run zigttp"
        else
            runtimes_to_run="zigttp"
        fi
        runtime_count=$((runtime_count + 1))
    else
        echo "zigttp not built, skipping"
        STATUS_ZIGTTP="skipped:not built"
    fi
fi

current_idx=0
for runtime in $runtimes_to_run; do
    case "$runtime" in
        deno)
            PORT=$PORT_DENO
            run_coldstart "deno" "\"PORT=$PORT deno run --allow-net --allow-env $PROJECT_DIR/handlers/deno/server.ts\"" && STATUS_DENO="success" || STATUS_DENO="failed"
            ;;
        zigttp)
            PORT=$PORT_ZIGTTP
            run_coldstart "zigttp" "\"$ZIGTTP_BIN -p $PORT -q $PROJECT_DIR/handlers/zigttp/handler.js\"" && STATUS_ZIGTTP="success" || STATUS_ZIGTTP="failed"
            ;;
    esac

    current_idx=$((current_idx + 1))
    if [ $current_idx -lt $runtime_count ]; then
        echo "Cooldown: ${COOLDOWN_SECS}s before next runtime..."
        sleep "$COOLDOWN_SECS"
    fi
done

echo "=== Cold Start Benchmarks Complete ==="
echo ""
echo "Runtime Status:"
if [ -n "$STATUS_DENO" ]; then
    echo "  deno: $STATUS_DENO"
fi
if [ -n "$STATUS_ZIGTTP" ]; then
    echo "  zigttp: $STATUS_ZIGTTP"
fi

exit 0
