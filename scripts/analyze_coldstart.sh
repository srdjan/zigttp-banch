#!/bin/bash
# Detailed cold start analysis with phase breakdown

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

ZIGTP_PROJECT_DIR="${ZIGTP_PROJECT_DIR:-$PROJECT_DIR/../zigttp}"
ZIGTTP_BIN="$ZIGTP_PROJECT_DIR/zig-out/bin/zigttp-server"
HANDLER_PATH="$PROJECT_DIR/handlers/zigttp/handler.js"
PORT=3102

if [[ ! -x "$ZIGTTP_BIN" ]]; then
    echo "zigttp-server not found at $ZIGTTP_BIN"
    exit 1
fi

echo "Cold Start Phase Analysis"
echo "=========================="
echo ""

# Clean up any existing server
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
sleep 0.5

# Measure complete cold start timing
iterations=20
total_spawn_to_ready_us=0
total_first_request_us=0

for i in $(seq 1 $iterations); do
    # Kill any existing server
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

    # Wait for port to be free
    while lsof -ti:$PORT >/dev/null 2>&1; do
        sleep 0.01
    done

    # Time: process spawn to server ready
    start_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')

    "$ZIGTTP_BIN" -p "$PORT" -q "$HANDLER_PATH" >/dev/null 2>&1 &
    server_pid=$!

    # Wait for port to be listening
    while ! lsof -ti:$PORT >/dev/null 2>&1; do
        if ! kill -0 $server_pid 2>/dev/null; then
            echo "Server died during startup!"
            exit 1
        fi
        sleep 0.001
    done

    port_ready_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')

    # Make first request
    response=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null || echo "")

    first_request_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')

    # Clean up
    kill -9 $server_pid 2>/dev/null || true
    wait $server_pid 2>/dev/null || true

    spawn_to_ready=$((port_ready_us - start_us))
    ready_to_response=$((first_request_us - port_ready_us))
    total_time=$((first_request_us - start_us))

    total_spawn_to_ready_us=$((total_spawn_to_ready_us + spawn_to_ready))
    total_first_request_us=$((total_first_request_us + ready_to_response))

    if [[ $i -le 5 ]]; then
        printf "  Run %2d: spawn->port=%5dus, port->response=%5dus, total=%5dus\n" \
            $i $spawn_to_ready $ready_to_response $total_time
    fi
done

echo ""
echo "Average timings (${iterations} iterations):"
avg_spawn_to_ready=$((total_spawn_to_ready_us / iterations))
avg_first_request=$((total_first_request_us / iterations))
avg_total=$((avg_spawn_to_ready + avg_first_request))

printf "  Spawn to port listening:  %6dus (%3dms)  %.1f%%\n" \
    $avg_spawn_to_ready $((avg_spawn_to_ready / 1000)) \
    $(echo "scale=1; $avg_spawn_to_ready * 100.0 / $avg_total" | bc)

printf "  Port ready to response:   %6dus (%3dms)  %.1f%%\n" \
    $avg_first_request $((avg_first_request / 1000)) \
    $(echo "scale=1; $avg_first_request * 100.0 / $avg_total" | bc)

printf "  Total cold start:         %6dus (%3dms)\n" \
    $avg_total $((avg_total / 1000))

echo ""
echo "Process characteristics:"
"$ZIGTTP_BIN" -p "$PORT" -q "$HANDLER_PATH" >/dev/null 2>&1 &
server_pid=$!
sleep 0.5

if kill -0 $server_pid 2>/dev/null; then
    # Memory footprint
    mem_kb=$(ps -o rss= -p $server_pid | awk '{print $1}')
    mem_mb=$(echo "scale=1; $mem_kb / 1024" | bc)
    echo "  Memory (RSS): ${mem_kb} KB (${mem_mb} MB)"

    # Thread count
    thread_count=$(ps -M -p $server_pid | grep -c "^" || echo "N/A")
    echo "  Thread count: $thread_count"

    # Binary size
    binary_size=$(ls -lh "$ZIGTTP_BIN" | awk '{print $5}')
    echo "  Binary size: $binary_size"
fi

kill -9 $server_pid 2>/dev/null || true
wait $server_pid 2>/dev/null || true

echo ""
echo "Handler characteristics:"
handler_lines=$(wc -l < "$HANDLER_PATH")
handler_bytes=$(wc -c < "$HANDLER_PATH")
echo "  Handler size: ${handler_lines} lines, ${handler_bytes} bytes"

# Clean up
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
