#!/bin/bash
# Quick summary comparison script
# Runs key benchmarks and outputs a comparison table
# Usage: ./run_summary.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_DIR/results/summary_$(date +%Y%m%d_%H%M%S)"
ZIGTTP_BIN="$PROJECT_DIR/../zigttp/zig-out/bin/zigttp-server"

mkdir -p "$RESULTS_DIR"

echo "========================================"
echo "  zigttp vs Deno Comparison"
echo "========================================"
echo ""

# Check prerequisites
if ! command -v deno &> /dev/null; then
    echo "Error: deno not found"
    exit 1
fi

if [ ! -x "$ZIGTTP_BIN" ]; then
    echo "Error: zigttp not built (run: cd ../zigttp && zig build -Doptimize=ReleaseFast)"
    exit 1
fi

# Results storage
DENO_COLDSTART=""
ZIGTTP_COLDSTART=""
DENO_MEMORY=""
ZIGTTP_MEMORY=""
DENO_RPS=""
ZIGTTP_RPS=""

# Helper to pick a free port
pick_free_port() {
    python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

# 1. Cold Start Comparison (10 iterations each)
echo "Running cold start comparison (10 iterations)..."
ITERATIONS=10

# Deno cold start
deno_times=""
for i in $(seq 1 $ITERATIONS); do
    start=$(python3 -c "import time; print(time.time() * 1000)")
    output=$(deno eval "console.log('ready')" 2>&1)
    end=$(python3 -c "import time; print(time.time() * 1000)")
    elapsed=$(echo "$end - $start" | bc)
    deno_times="$deno_times $elapsed"
done
DENO_COLDSTART=$(echo $deno_times | tr ' ' '\n' | sort -n | awk 'NR==int((NR+1)/2)')

# zigttp cold start
zigttp_times=""
for i in $(seq 1 $ITERATIONS); do
    start=$(python3 -c "import time; print(time.time() * 1000)")
    output=$("$ZIGTTP_BIN" -e "print('ready')" 2>&1)
    end=$(python3 -c "import time; print(time.time() * 1000)")
    elapsed=$(echo "$end - $start" | bc)
    zigttp_times="$zigttp_times $elapsed"
done
ZIGTTP_COLDSTART=$(echo $zigttp_times | tr ' ' '\n' | sort -n | awk 'NR==int((NR+1)/2)')

echo "  deno: ${DENO_COLDSTART}ms, zigttp: ${ZIGTTP_COLDSTART}ms"

# 2. Memory Comparison (baseline RSS)
echo "Running memory comparison..."

# Deno memory
PORT=$(pick_free_port)
PORT=$PORT deno run --allow-net --allow-env "$PROJECT_DIR/handlers/deno/server.ts" &
DENO_PID=$!
sleep 2
if kill -0 $DENO_PID 2>/dev/null; then
    DENO_MEMORY=$(ps -o rss= -p $DENO_PID 2>/dev/null | tr -d ' ')
    DENO_MEMORY=$((DENO_MEMORY / 1024))  # Convert to MB
    kill $DENO_PID 2>/dev/null
    wait $DENO_PID 2>/dev/null
fi

sleep 1

# zigttp memory
PORT=$(pick_free_port)
"$ZIGTTP_BIN" -p $PORT -q "$PROJECT_DIR/handlers/zigttp/handler.js" &
ZIGTTP_PID=$!
sleep 2
if kill -0 $ZIGTTP_PID 2>/dev/null; then
    ZIGTTP_MEMORY=$(ps -o rss= -p $ZIGTTP_PID 2>/dev/null | tr -d ' ')
    ZIGTTP_MEMORY=$((ZIGTTP_MEMORY / 1024))  # Convert to MB
    kill $ZIGTTP_PID 2>/dev/null
    wait $ZIGTTP_PID 2>/dev/null
fi

echo "  deno: ${DENO_MEMORY}MB, zigttp: ${ZIGTTP_MEMORY}MB"

# 3. HTTP Throughput Comparison (single connection, 10s)
echo "Running HTTP throughput comparison (10s, 1 connection)..."

# Deno HTTP
PORT=$(pick_free_port)
PORT=$PORT deno run --allow-net --allow-env "$PROJECT_DIR/handlers/deno/server.ts" &>/dev/null &
DENO_PID=$!
sleep 2
if curl -s "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    hey_output=$(hey -c 1 -z 10s "http://127.0.0.1:$PORT/api/health" 2>&1)
    DENO_RPS=$(echo "$hey_output" | grep "Requests/sec" | awk '{printf "%.0f", $2}')
fi
kill $DENO_PID 2>/dev/null
wait $DENO_PID 2>/dev/null

sleep 1

# zigttp HTTP
PORT=$(pick_free_port)
"$ZIGTTP_BIN" -p $PORT -q "$PROJECT_DIR/handlers/zigttp/handler.js" &>/dev/null &
ZIGTTP_PID=$!
sleep 2
if curl -s "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    hey_output=$(hey -c 1 -z 10s "http://127.0.0.1:$PORT/api/health" 2>&1)
    ZIGTTP_RPS=$(echo "$hey_output" | grep "Requests/sec" | awk '{printf "%.0f", $2}')
fi
kill $ZIGTTP_PID 2>/dev/null
wait $ZIGTTP_PID 2>/dev/null

echo "  deno: ${DENO_RPS} RPS, zigttp: ${ZIGTTP_RPS} RPS"

# Print comparison table
echo ""
echo "========================================"
echo "  Summary Comparison"
echo "========================================"
echo ""

printf "| %-20s | %-12s | %-12s | %-8s |\n" "Metric" "zigttp" "Deno" "Winner"
printf "|%-22s|%-14s|%-14s|%-10s|\n" "----------------------" "--------------" "--------------" "----------"

# Cold Start
if [ -n "$ZIGTTP_COLDSTART" ] && [ -n "$DENO_COLDSTART" ]; then
    if [ "$(echo "$ZIGTTP_COLDSTART < $DENO_COLDSTART" | bc)" -eq 1 ]; then
        WINNER="zigttp"
    elif [ "$(echo "$ZIGTTP_COLDSTART > $DENO_COLDSTART" | bc)" -eq 1 ]; then
        WINNER="deno"
    else
        WINNER="tie"
    fi
    printf "| %-20s | %-12s | %-12s | %-8s |\n" "Cold Start (p50)" "${ZIGTTP_COLDSTART}ms" "${DENO_COLDSTART}ms" "$WINNER"
fi

# Memory
if [ -n "$ZIGTTP_MEMORY" ] && [ -n "$DENO_MEMORY" ]; then
    if [ "$ZIGTTP_MEMORY" -lt "$DENO_MEMORY" ]; then
        WINNER="zigttp"
    elif [ "$ZIGTTP_MEMORY" -gt "$DENO_MEMORY" ]; then
        WINNER="deno"
    else
        WINNER="tie"
    fi
    printf "| %-20s | %-12s | %-12s | %-8s |\n" "Memory Baseline" "${ZIGTTP_MEMORY} MB" "${DENO_MEMORY} MB" "$WINNER"
fi

# HTTP RPS
if [ -n "$ZIGTTP_RPS" ] && [ -n "$DENO_RPS" ]; then
    if [ "$ZIGTTP_RPS" -gt "$DENO_RPS" ]; then
        WINNER="zigttp"
    elif [ "$ZIGTTP_RPS" -lt "$DENO_RPS" ]; then
        WINNER="deno"
    else
        WINNER="tie"
    fi
    printf "| %-20s | %-12s | %-12s | %-8s |\n" "HTTP RPS (1 conn)" "$ZIGTTP_RPS" "$DENO_RPS" "$WINNER"
fi

echo ""
echo "Results saved to: $RESULTS_DIR"

# Save results to JSON
cat > "$RESULTS_DIR/summary.json" <<EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "cold_start_ms": {
        "deno": ${DENO_COLDSTART:-0},
        "zigttp": ${ZIGTTP_COLDSTART:-0}
    },
    "memory_mb": {
        "deno": ${DENO_MEMORY:-0},
        "zigttp": ${ZIGTTP_MEMORY:-0}
    },
    "http_rps": {
        "deno": ${DENO_RPS:-0},
        "zigttp": ${ZIGTTP_RPS:-0}
    }
}
EOF

exit 0
