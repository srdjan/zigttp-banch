#!/bin/bash
# Benchmark pre-fork worker pool vs regular cold starts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Pre-Fork Worker Pool Benchmark"
echo "==============================="
echo ""

# Build optimized zigttp
echo "Building optimized zigttp..."
"$SCRIPT_DIR/build_optimized.sh" > /dev/null 2>&1
echo ""

# Test 1: Regular cold start (baseline)
echo "Test 1: Regular Cold Start (baseline)"
echo "--------------------------------------"

iterations=20
total_time_us=0

for i in $(seq 1 $iterations); do
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true
    sleep 0.1

    start_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')

    ../zigttp/zig-out/bin/zigttp-server -p 8080 -q > /dev/null 2>&1 &
    server_pid=$!

    # Wait for server
    while ! curl -s http://localhost:8080/api/health > /dev/null 2>&1; do
        if ! kill -0 $server_pid 2>/dev/null; then
            echo "Server died!"
            exit 1
        fi
        sleep 0.001
    done

    end_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')
    elapsed=$((end_us - start_us))
    total_time_us=$((total_time_us + elapsed))

    kill -9 $server_pid 2>/dev/null || true
    wait $server_pid 2>/dev/null || true

    if [[ $i -le 3 ]]; then
        echo "  Iteration $i: ${elapsed}us"
    fi
done

baseline_avg_us=$((total_time_us / iterations))
baseline_avg_ms=$((baseline_avg_us / 1000))

echo "  Average: ${baseline_avg_us}us (${baseline_avg_ms}ms)"
echo ""

# Test 2: Pre-fork worker pool
echo "Test 2: Pre-Fork Worker Pool"
echo "-----------------------------"

# Start worker pool in background
"$PROJECT_DIR/tools/prefork-pool.ts" > /tmp/prefork.log 2>&1 &
pool_pid=$!

# Wait for pool to be ready
sleep 2

# Check if pool started
if ! kill -0 $pool_pid 2>/dev/null; then
    echo "Error: Worker pool failed to start"
    cat /tmp/prefork.log
    exit 1
fi

echo "Worker pool started (PID: $pool_pid)"
echo ""

# Measure request latency (workers already warmed)
total_request_us=0

for i in $(seq 1 $iterations); do
    start_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')

    curl -s http://localhost:8080/api/health > /dev/null 2>&1

    end_us=$(python3 -c 'import time; print(int(time.time() * 1_000_000))')
    elapsed=$((end_us - start_us))
    total_request_us=$((total_request_us + elapsed))

    if [[ $i -le 3 ]]; then
        echo "  Request $i: ${elapsed}us"
    fi
done

prefork_avg_us=$((total_request_us / iterations))
prefork_avg_ms=$((prefork_avg_us / 1000))

echo "  Average: ${prefork_avg_us}us (${prefork_avg_ms}ms)"
echo ""

# Cleanup
kill -TERM $pool_pid 2>/dev/null || true
wait $pool_pid 2>/dev/null || true
lsof -ti:8080,8081,8082,8083,8084 | xargs kill -9 2>/dev/null || true

# Results
echo "Results"
echo "======="
echo ""
echo "Baseline (cold start):     ${baseline_avg_us}us (${baseline_avg_ms}ms)"
echo "Pre-fork pool (warm):      ${prefork_avg_us}us (${prefork_avg_ms}ms)"

savings_us=$((baseline_avg_us - prefork_avg_us))
savings_ms=$((savings_us / 1000))
savings_pct=$(echo "scale=1; $savings_us * 100.0 / $baseline_avg_us" | bc)

echo ""
echo "Improvement:               ${savings_us}us (${savings_ms}ms)"
echo "Reduction:                 ${savings_pct}%"
echo ""

if [[ $savings_ms -ge 40 ]]; then
    echo "✓ Achieved expected ~40ms improvement"
else
    echo "Note: Improvement less than expected 40ms"
    echo "      (Pool startup time is amortized across all requests)"
fi
