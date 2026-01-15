#!/bin/bash
# HTTP benchmark runner
# Usage: ./run_http.sh <results_dir> [runtime] [connections]

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"
CONNECTIONS="${3:-10}"

# Unique base ports per runtime to avoid conflicts
PORT_DENO=8080
PORT_ZIGTTP=8081

PORT=""  # Set per-runtime
WARMUP_REQUESTS=1000
DURATION="30s"
ENDPOINTS="/api/health /api/echo /api/greet/world"
COOLDOWN_SECS=2

# Track runtime results (bash 3.x compatible)
STATUS_DENO=""
STATUS_ZIGTTP=""

mkdir -p "$RESULTS_DIR"

CURRENT_SERVER_PID=""

stop_server() {
    local pid="${1:-}"
    # Note: Removed PGID killing as it can kill the script itself

    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null || true

        # Wait for process to die
        local attempts=0
        while [ $attempts -lt 20 ]; do
            if ! kill -0 "$pid" 2>/dev/null; then
                break
            fi
            attempts=$((attempts + 1))
            sleep 0.1
        done

        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
}

cleanup_on_exit() {
    stop_server "$CURRENT_SERVER_PID"
}

trap cleanup_on_exit EXIT INT TERM

port_is_free() {
    local port=$1
    if command -v lsof &> /dev/null; then
        ! lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
        return
    fi
    python3 - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.exit(1)
else:
    sys.exit(0)
finally:
    s.close()
PY
}

pick_free_port() {
    python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

ensure_port_free() {
    if ! port_is_free "$PORT"; then
        local new_port
        new_port="$(pick_free_port)"
        echo "Port $PORT is in use, switching to $new_port"
        PORT="$new_port"
    fi
}

wait_for_port_free() {
    local max_attempts=50
    local attempt=0
    while ! port_is_free "$PORT"; do
        attempt=$((attempt + 1))
        if [ $attempt -ge $max_attempts ]; then
            return 1
        fi
        sleep 0.1
    done
}

# Function to wait for server to be ready
wait_for_server() {
    local max_attempts=50
    local attempt=0
    while ! curl -s "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; do
        attempt=$((attempt + 1))
        if [ $attempt -ge $max_attempts ]; then
            echo "Server failed to start" >&2
            return 1
        fi
        sleep 0.1
    done
}

# Function to run benchmark for a single runtime/endpoint combination
run_benchmark() {
    local runtime=$1
    local endpoint=$2
    local conns=$3
    local output_file="$RESULTS_DIR/http_${runtime}_$(echo $endpoint | tr '/' '_')_${conns}c.json"

    echo "  Endpoint: $endpoint ($conns connections)"

    # Warmup
    hey -n $WARMUP_REQUESTS -c 10 "http://127.0.0.1:$PORT$endpoint" > /dev/null 2>&1 || true
    sleep 1

    # Measured run
    local hey_output=$(hey -c "$conns" -z "$DURATION" "http://127.0.0.1:$PORT$endpoint" 2>&1)

    # Parse hey output
    local rps=$(echo "$hey_output" | grep "Requests/sec" | awk '{print $2}')
    local latency_avg=$(echo "$hey_output" | grep "Average:" | head -1 | awk '{print $2}')
    local latency_p50=$(echo "$hey_output" | grep "50% in" | awk '{print $3}')
    local latency_p95=$(echo "$hey_output" | grep "95% in" | awk '{print $3}')
    local latency_p99=$(echo "$hey_output" | grep "99% in" | awk '{print $3}')
    local errors=$(echo "$hey_output" | awk '/^[[:space:]]*\[/ { if ($0 !~ /200/) count++ } END { print (count+0) }')

    # Default to 0 if empty
    rps="${rps:-0}"
    latency_avg="${latency_avg:-0}"
    latency_p50="${latency_p50:-0}"
    latency_p95="${latency_p95:-0}"
    latency_p99="${latency_p99:-0}"
    errors="${errors:-0}"

    cat > "$output_file" <<EOF
{
    "type": "http_benchmark",
    "runtime": "$runtime",
    "endpoint": "$endpoint",
    "connections": $conns,
    "duration": "$DURATION",
    "warmup_requests": $WARMUP_REQUESTS,
    "metrics": {
        "requests_per_second": $rps,
        "latency_avg_secs": $latency_avg,
        "latency_p50_secs": $latency_p50,
        "latency_p95_secs": $latency_p95,
        "latency_p99_secs": $latency_p99,
        "errors": $errors
    },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo "    RPS: $rps, p99: ${latency_p99}s"
}

# Helper to set runtime status (bash 3.x compatible)
set_runtime_status() {
    local runtime=$1
    local status=$2
    case "$runtime" in
        deno) STATUS_DENO="$status" ;;
        zigttp) STATUS_ZIGTTP="$status" ;;
    esac
}

# Helper to get port for runtime
get_runtime_port() {
    local runtime=$1
    case "$runtime" in
        deno) echo "$PORT_DENO" ;;
        zigttp) echo "$PORT_ZIGTTP" ;;
        *) echo "8080" ;;
    esac
}

# Function to run all benchmarks for a runtime
run_runtime() {
    local runtime=$1
    local server_pid
    local server_cmd=""

    echo "=== Benchmarking $runtime ==="

    # Use runtime-specific base port
    PORT="$(get_runtime_port "$runtime")"
    ensure_port_free

    case "$runtime" in
        deno)
            server_cmd="PORT=$PORT deno run --allow-net --allow-env $PROJECT_DIR/handlers/deno/server.ts"
            ;;
        zigttp)
            server_cmd="$ZIGTTP_BIN -p $PORT -q $PROJECT_DIR/handlers/zigttp/handler.js"
            ;;
        *)
            echo "Unknown runtime: $runtime"
            set_runtime_status "$runtime" "unknown"
            return 1
            ;;
    esac

    # Start server
    eval "$server_cmd" &
    server_pid=$!
    CURRENT_SERVER_PID="$server_pid"
    sleep 2

    if ! wait_for_server; then
        echo "Failed to start $runtime server"
        stop_server "$CURRENT_SERVER_PID"
        CURRENT_SERVER_PID=""
        set_runtime_status "$runtime" "failed:startup"
        return 1
    fi

    # Run benchmarks for each endpoint
    local benchmark_errors=0
    for endpoint in $ENDPOINTS; do
        if ! run_benchmark "$runtime" "$endpoint" "$CONNECTIONS"; then
            benchmark_errors=$((benchmark_errors + 1))
        fi
    done

    # Kill server
    stop_server "$CURRENT_SERVER_PID"
    CURRENT_SERVER_PID=""
    if ! wait_for_port_free; then
        echo "Warning: port $PORT still in use after stopping $runtime, picking a new port"
    fi

    if [ $benchmark_errors -eq 0 ]; then
        set_runtime_status "$runtime" "success"
    else
        set_runtime_status "$runtime" "partial:$benchmark_errors errors"
    fi

    echo ""
}

# Main execution
echo "HTTP Benchmark Suite"
echo "Results: $RESULTS_DIR"
echo "Connections: $CONNECTIONS"
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
        echo "zigttp not built, skipping (run: cd ../zigttp && zig build -Doptimize=ReleaseFast)"
        STATUS_ZIGTTP="skipped:not built"
    fi
fi

# Run each runtime with cooldown between them
current_idx=0
for runtime in $runtimes_to_run; do
    run_runtime "$runtime" || true  # Continue even if runtime fails

    current_idx=$((current_idx + 1))
    # Add cooldown between runtimes (not after the last one)
    if [ $current_idx -lt $runtime_count ]; then
        echo "Cooldown: ${COOLDOWN_SECS}s before next runtime..."
        sleep "$COOLDOWN_SECS"
    fi
done

echo "=== HTTP Benchmarks Complete ==="
echo ""
echo "Runtime Status:"
if [ -n "$STATUS_DENO" ]; then
    echo "  deno: $STATUS_DENO"
fi
if [ -n "$STATUS_ZIGTTP" ]; then
    echo "  zigttp: $STATUS_ZIGTTP"
fi

exit 0
