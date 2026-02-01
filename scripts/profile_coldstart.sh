#!/bin/bash
# Profile zigttp cold start to identify optimization opportunities

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_BASE="$PROJECT_DIR/results"

RESULTS_DIR="${RESULTS_DIR:-$RESULTS_BASE/$(date +%Y%m%d_%H%M%S)_$$_$RANDOM}"
mkdir -p "$RESULTS_DIR"

# Accept ZIGTTP_DIR (preferred) or legacy ZIGTP_PROJECT_DIR
ZIGTTP_DIR="${ZIGTTP_DIR:-${ZIGTP_PROJECT_DIR:-$PROJECT_DIR/../zigttp}}"
ZIGTTP_BUILD_FLAGS="${ZIGTTP_BUILD_FLAGS:-${ZIGTP_BUILD_FLAGS:--Doptimize=ReleaseFast}}"

# Build zigttp server in release mode
echo "Building zigttp server ($ZIGTTP_BUILD_FLAGS)"
(
    cd "$ZIGTTP_DIR"
    zig build $ZIGTTP_BUILD_FLAGS
)

ZIGTTP_BIN="$ZIGTTP_DIR/zig-out/bin/zigttp-server"
if [[ ! -x "$ZIGTTP_BIN" ]]; then
    echo "zigttp-server not found at $ZIGTTP_BIN"
    exit 1
fi

HANDLER_PATH="$PROJECT_DIR/handlers/zigttp/handler.js"
PORT="${PORT:-3100}"

# Shared flamegraph tools (ensure_flamegraph_tools, detect_profile_method)
source "$SCRIPT_DIR/flamegraph_tools.sh"

detect_profile_method
ensure_flamegraph_tools "$PROFILE_METHOD"

SAMPLE_OUT="$RESULTS_DIR/coldstart_sample.txt"
FOLDED_OUT="$RESULTS_DIR/coldstart_stacks.folded"
SVG_OUT="$RESULTS_DIR/coldstart_flamegraph.svg"

echo "Cold Start Profiling (zigttp)"
echo "Results: $RESULTS_DIR"
echo "Profile method: $PROFILE_METHOD"
echo ""

# Kill any existing server on the port
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
sleep 0.5

if [[ "$PROFILE_METHOD" == "sample" ]]; then
    # Start server in background
    "$ZIGTTP_BIN" -p "$PORT" -q "$HANDLER_PATH" &
    server_pid=$!

    # Profile for 5 seconds to capture full startup and warmup
    sleep 0.1
    sample "$server_pid" 5 -file "$SAMPLE_OUT" >/dev/null 2>&1 || true

    # Make several requests to ensure it started and warmed up
    for i in {1..5}; do
        curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1 || true
        sleep 0.1
    done

    # Kill server
    kill -9 "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true

    # Generate flamegraph
    awk -f "$STACKCOLLAPSE_BIN" "$SAMPLE_OUT" > "$FOLDED_OUT"
    "$FLAMEGRAPH_BIN" "$FOLDED_OUT" > "$SVG_OUT"

else
    # Linux perf profiling
    PERF_DATA="$RESULTS_DIR/coldstart_perf.data"
    PERF_SCRIPT_OUT="$RESULTS_DIR/coldstart_perf.script"

    if ! command -v perf &> /dev/null; then
        echo "perf not found"
        exit 1
    fi

    # Profile server startup and first request
    (sleep 0.5 && curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1) &

    timeout 3s perf record -F 99 -g -o "$PERF_DATA" -- \
        "$ZIGTTP_BIN" -p "$PORT" -q "$HANDLER_PATH" 2>/dev/null || true

    perf script -i "$PERF_DATA" > "$PERF_SCRIPT_OUT"
    "$STACKCOLLAPSE_BIN" "$PERF_SCRIPT_OUT" > "$FOLDED_OUT"
    "$FLAMEGRAPH_BIN" "$FOLDED_OUT" > "$SVG_OUT"
fi

# Clean up
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

echo ""
echo "Flamegraph written to: $SVG_OUT"
echo ""
echo "Hot spots (top stack frames):"
if [[ -f "$FOLDED_OUT" ]]; then
    # Extract function names and count samples
    grep -o ';[^;]*;[0-9]*$' "$FOLDED_OUT" | \
        sed 's/^;//;s/;/ /' | \
        awk '{funcs[$1]+=$2} END {for(f in funcs) print funcs[f], f}' | \
        sort -rn | head -20 | \
        awk '{printf "  %s: %d samples\n", $2, $1}'
fi
