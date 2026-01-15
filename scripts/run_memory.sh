#!/bin/bash
# Memory profiling runner
# Measures baseline RSS and RSS under load

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"

# Unique ports per runtime
PORT_DENO=8080
PORT_ZIGTTP=8081
PORT=""  # Set per-runtime

LOAD_DURATION=30
SAMPLE_INTERVAL_MS=100

# Track status
STATUS_DENO=""
STATUS_ZIGTTP=""
COOLDOWN_SECS=2

mkdir -p "$RESULTS_DIR"

wait_for_server() {
    local max_attempts=50
    local attempt=0
    while ! curl -s "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; do
        attempt=$((attempt + 1))
        if [ $attempt -ge $max_attempts ]; then
            return 1
        fi
        sleep 0.1
    done
}

get_rss_kb() {
    local pid=$1
    if [[ "$(uname)" == "Darwin" ]]; then
        ps -o rss= -p "$pid" 2>/dev/null | xargs || echo "0"
    else
        ps -o rss= -p "$pid" 2>/dev/null | xargs || echo "0"
    fi
}

run_memory_profile() {
    local runtime=$1
    local cmd=$2

    echo "=== Memory Profile: $runtime ==="

    # Start server
    eval "$cmd" &
    local server_pid=$!
    sleep 2

    if ! wait_for_server; then
        echo "  Failed to start server"
        kill $server_pid 2>/dev/null || true
        return 1
    fi

    # Baseline RSS
    local baseline_kb=$(get_rss_kb $server_pid)
    echo "  Baseline RSS: ${baseline_kb} KB"

    # Start load in background
    hey -c 10 -z "${LOAD_DURATION}s" "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1 &
    local load_pid=$!

    # Sample RSS during load
    local samples=()
    local sample_count=$((LOAD_DURATION * 1000 / SAMPLE_INTERVAL_MS))
    for i in $(seq 1 $sample_count); do
        local rss=$(get_rss_kb $server_pid)
        samples+=("$rss")
        sleep 0.$((SAMPLE_INTERVAL_MS / 10))
    done

    # Wait for load to finish
    wait $load_pid 2>/dev/null || true

    # Peak RSS
    local peak_kb=$(printf '%s\n' "${samples[@]}" | sort -rn | head -1)
    echo "  Peak RSS: ${peak_kb} KB"

    # Calculate average
    local avg_kb=$(python3 -c "data=[${samples[*]}]; print(int(sum(data)/len(data)))")
    echo "  Avg RSS: ${avg_kb} KB"

    # Kill server
    kill $server_pid 2>/dev/null || true
    wait $server_pid 2>/dev/null || true

    # Write results
    cat > "$RESULTS_DIR/memory_${runtime}.json" <<EOF
{
    "type": "memory_profile",
    "runtime": "$runtime",
    "metrics": {
        "baseline_kb": $baseline_kb,
        "peak_kb": $peak_kb,
        "avg_kb": $avg_kb,
        "samples": $sample_count
    },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo ""
}

echo "Memory Profiling Suite"
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
            run_memory_profile "deno" "PORT=$PORT deno run --allow-net --allow-env $PROJECT_DIR/handlers/deno/server.ts" && STATUS_DENO="success" || STATUS_DENO="failed"
            ;;
        zigttp)
            PORT=$PORT_ZIGTTP
            run_memory_profile "zigttp" "$ZIGTTP_BIN -p $PORT -q $PROJECT_DIR/handlers/zigttp/handler.js" && STATUS_ZIGTTP="success" || STATUS_ZIGTTP="failed"
            ;;
    esac

    current_idx=$((current_idx + 1))
    if [ $current_idx -lt $runtime_count ]; then
        echo "Cooldown: ${COOLDOWN_SECS}s before next runtime..."
        sleep "$COOLDOWN_SECS"
    fi
done

echo "=== Memory Profiling Complete ==="
echo ""
echo "Runtime Status:"
if [ -n "$STATUS_DENO" ]; then
    echo "  deno: $STATUS_DENO"
fi
if [ -n "$STATUS_ZIGTTP" ]; then
    echo "  zigttp: $STATUS_ZIGTTP"
fi

exit 0
