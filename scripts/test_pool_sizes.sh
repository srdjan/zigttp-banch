#!/bin/bash
# Test cold start with different pool sizes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

ZIGTP_PROJECT_DIR="${ZIGTP_PROJECT_DIR:-$PROJECT_DIR/../zigttp}"
ZIGTTP_BIN="$ZIGTP_PROJECT_DIR/zig-out/bin/zigttp-server"
HANDLER_PATH="$PROJECT_DIR/handlers/zigttp/handler.js"
PORT=3103

if [[ ! -x "$ZIGTTP_BIN" ]]; then
    echo "zigttp-server not found at $ZIGTTP_BIN"
    exit 1
fi

echo "Pool Size Impact on Cold Start"
echo "==============================="
echo ""

for pool_size in 1 2 4 8 16 28; do
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
    sleep 0.3

    iterations=10
    total_us=0

    for i in $(seq 1 $iterations); do
        lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

        while lsof -ti:$PORT >/dev/null 2>&1; do
            sleep 0.01
        done

        start_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')

        "$ZIGTTP_BIN" -p "$PORT" -n "$pool_size" -q "$HANDLER_PATH" >/dev/null 2>&1 &
        server_pid=$!

        while ! lsof -ti:$PORT >/dev/null 2>&1; do
            if ! kill -0 $server_pid 2>/dev/null; then
                echo "Server died!"
                exit 1
            fi
            sleep 0.001
        done

        end_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')
        elapsed=$((end_us - start_us))
        total_us=$((total_us + elapsed))

        kill -9 $server_pid 2>/dev/null || true
        wait $server_pid 2>/dev/null || true
    done

    avg_us=$((total_us / iterations))
    avg_ms=$((avg_us / 1000))

    printf "  Pool size %2d: %6dus (%3dms)\n" $pool_size $avg_us $avg_ms
done

echo ""
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
