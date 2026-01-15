#!/bin/bash
# HTTP benchmark runner
# Usage: ./run_http.sh <results_dir> [runtime] [connections]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="${1:-$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)}"
RUNTIME="${2:-all}"
CONNECTIONS="${3:-10}"

PORT="${PORT:-8080}"
WARMUP_REQUESTS=1000
DURATION="30s"
ENDPOINTS=("/api/health" "/api/echo" "/api/greet/world")

mkdir -p "$RESULTS_DIR"

CURRENT_SERVER_PID=""
CURRENT_SERVER_PGID=""

get_pgid() {
    local pid=$1
    if command -v ps &> /dev/null; then
        ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' '
    fi
}

stop_server() {
    local pid="${1:-}"
    local pgid="${2:-}"

    if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
    fi
    if [[ -n "$pgid" ]]; then
        kill "-$pgid" 2>/dev/null || true
    fi

    if [[ -n "$pid" ]]; then
        for _ in {1..20}; do
            if ! kill -0 "$pid" 2>/dev/null; then
                break
            fi
            sleep 0.1
        done
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
    if [[ -n "$pgid" ]]; then
        kill -9 "-$pgid" 2>/dev/null || true
    fi
}

cleanup_on_exit() {
    stop_server "$CURRENT_SERVER_PID" "$CURRENT_SERVER_PGID"
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

    cat > "$output_file" <<EOF
{
    "type": "http_benchmark",
    "runtime": "$runtime",
    "endpoint": "$endpoint",
    "connections": $conns,
    "duration": "$DURATION",
    "warmup_requests": $WARMUP_REQUESTS,
    "metrics": {
        "requests_per_second": ${rps:-0},
        "latency_avg_secs": ${latency_avg:-0},
        "latency_p50_secs": ${latency_p50:-0},
        "latency_p95_secs": ${latency_p95:-0},
        "latency_p99_secs": ${latency_p99:-0},
        "errors": ${errors:-0}
    },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo "    RPS: $rps, p99: ${latency_p99}s"
}

# Function to run all benchmarks for a runtime
run_runtime() {
    local runtime=$1
    local server_pid
    local server_cmd=""

    echo "=== Benchmarking $runtime ==="

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
            return 1
            ;;
    esac

    # Start server
    eval "$server_cmd" &
    server_pid=$!
    CURRENT_SERVER_PID="$server_pid"
    CURRENT_SERVER_PGID="$(get_pgid "$server_pid")"
    sleep 2

    if ! wait_for_server; then
        echo "Failed to start $runtime server"
        stop_server "$CURRENT_SERVER_PID" "$CURRENT_SERVER_PGID"
        CURRENT_SERVER_PID=""
        CURRENT_SERVER_PGID=""
        return 1
    fi

    # Run benchmarks for each endpoint
    for endpoint in "${ENDPOINTS[@]}"; do
        run_benchmark "$runtime" "$endpoint" "$CONNECTIONS"
    done

    # Kill server
    stop_server "$CURRENT_SERVER_PID" "$CURRENT_SERVER_PGID"
    CURRENT_SERVER_PID=""
    CURRENT_SERVER_PGID=""
    if ! wait_for_port_free; then
        echo "Warning: port $PORT still in use after stopping $runtime, picking a new port"
        PORT="$(pick_free_port)"
    fi
    sleep 1

    echo ""
}

# Main execution
echo "HTTP Benchmark Suite"
echo "Results: $RESULTS_DIR"
echo "Connections: $CONNECTIONS"
echo ""

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "deno" ]]; then
    run_runtime "deno"
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "zigttp" ]]; then
    ZIGTTP_BIN="$PROJECT_DIR/../zigttp/zig-out/bin/zigttp-server"
    if [[ -x "$ZIGTTP_BIN" ]]; then
        run_runtime "zigttp"
    else
        echo "zigttp not built, skipping (run: cd ../zigttp && zig build -Doptimize=ReleaseFast)"
    fi
fi

echo "=== HTTP Benchmarks Complete ==="
