#!/bin/bash
# Microbenchmark runner
# Runs JS execution benchmarks across all runtimes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_BASE="$PROJECT_DIR/results"
RUNTIME="${1:-all}"

if [[ -z "${RESULTS_DIR:-}" ]]; then
    RESULTS_DIR="$RESULTS_BASE/$(date +%Y%m%d_%H%M%S)_$$_$RANDOM"
else
    if [[ "$RESULTS_DIR" = /* ]]; then
        if [[ "$RESULTS_DIR" == "$RESULTS_BASE"* ]]; then
            RESULTS_DIR="$RESULTS_DIR"
        else
            RESULTS_DIR="$RESULTS_BASE/$(basename "$RESULTS_DIR")"
        fi
    else
        if [[ "$RESULTS_DIR" == results/* ]]; then
            RESULTS_DIR="$PROJECT_DIR/$RESULTS_DIR"
        else
            RESULTS_DIR="$RESULTS_BASE/$RESULTS_DIR"
        fi
    fi
fi

ensure_unique_results_dir() {
    if [[ -d "$RESULTS_DIR" ]]; then
        if [[ -n "$(ls -A "$RESULTS_DIR" 2>/dev/null)" ]]; then
            RESULTS_DIR="$RESULTS_BASE/$(date +%Y%m%d_%H%M%S)_$$_$RANDOM"
        fi
    fi
}

MICROBENCH_DIR="$PROJECT_DIR/microbench"
SUITE_PATH="$RESULTS_DIR/microbench_suite.js"

ensure_unique_results_dir
mkdir -p "$RESULTS_DIR"

# Create combined benchmark script that works across runtimes
BENCH_SCRIPT="$(cat \
    "$MICROBENCH_DIR/runner.js" \
    "$MICROBENCH_DIR/benchmarks/"*.js \
    "$MICROBENCH_DIR/suite.js" \
)"

if [[ -n "${BENCH_FILTER:-}" ]]; then
    FILTER_ESCAPED="${BENCH_FILTER//\\/\\\\}"
    FILTER_ESCAPED="${FILTER_ESCAPED//\"/\\\"}"
    BENCH_FILTER_HEADER="let __benchFilter = \"${FILTER_ESCAPED}\";"
    BENCH_SCRIPT="${BENCH_FILTER_HEADER}"$'\n'"${BENCH_SCRIPT}"
fi

if [[ -n "${BENCH_HTTP_HANDLER_HEAVY_ITERATIONS:-}" ]]; then
    BENCH_HEAVY_HEADER="let __httpHandlerHeavyIterations = ${BENCH_HTTP_HANDLER_HEAVY_ITERATIONS};"
    BENCH_SCRIPT="${BENCH_HEAVY_HEADER}"$'\n'"${BENCH_SCRIPT}"
fi

if [[ -n "${BENCH_WARMUP_ITERATIONS:-}" || -n "${BENCH_MEASURED_ITERATIONS:-}" || -n "${BENCH_WARMUP_MS:-}" || -n "${BENCH_MAX_MEASURED_TOTAL_MS:-}" ]]; then
    BENCH_CONFIG_BODY=""
    if [[ -n "${BENCH_WARMUP_ITERATIONS:-}" ]]; then
        BENCH_CONFIG_BODY="warmupIterations: ${BENCH_WARMUP_ITERATIONS}"
    fi
    if [[ -n "${BENCH_MEASURED_ITERATIONS:-}" ]]; then
        if [[ -n "$BENCH_CONFIG_BODY" ]]; then
            BENCH_CONFIG_BODY="${BENCH_CONFIG_BODY}, "
        fi
        BENCH_CONFIG_BODY="${BENCH_CONFIG_BODY}measuredIterations: ${BENCH_MEASURED_ITERATIONS}"
    fi
    if [[ -n "${BENCH_WARMUP_MS:-}" ]]; then
        if [[ -n "$BENCH_CONFIG_BODY" ]]; then
            BENCH_CONFIG_BODY="${BENCH_CONFIG_BODY}, "
        fi
        BENCH_CONFIG_BODY="${BENCH_CONFIG_BODY}warmupMs: ${BENCH_WARMUP_MS}"
    fi
    if [[ -n "${BENCH_MAX_MEASURED_TOTAL_MS:-}" ]]; then
        if [[ -n "$BENCH_CONFIG_BODY" ]]; then
            BENCH_CONFIG_BODY="${BENCH_CONFIG_BODY}, "
        fi
        BENCH_CONFIG_BODY="${BENCH_CONFIG_BODY}maxMeasuredTotalMs: ${BENCH_MAX_MEASURED_TOTAL_MS}"
    fi
    BENCH_CONFIG_HEADER="let __benchConfig = { ${BENCH_CONFIG_BODY} };"
    BENCH_SCRIPT="${BENCH_CONFIG_HEADER}"$'\n'"${BENCH_SCRIPT}"
fi

printf '%s' "$BENCH_SCRIPT" > "$SUITE_PATH"

run_microbench() {
    local runtime=$1
    local cmd=$2

    echo "=== Microbenchmarks: $runtime ==="

    local output=$(eval "$cmd" 2>/dev/null)

    if [[ -n "$output" ]]; then
        cat > "$RESULTS_DIR/microbench_${runtime}.json" <<EOF
{
    "type": "microbenchmark",
    "runtime": "$runtime",
    "benchmarks": $output,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
        echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for name, result in data.items():
    ops = result.get('ops_per_sec', 0)
    print(f\"  {name}: {ops:,.2f} ops/sec\")
"
    else
        echo "  Failed to run benchmarks"
    fi
    echo ""
}

run_zigttp_microbench() {
    local runtime="zigttp"
    local zigttp_bin="$PROJECT_DIR/../zigttp/zig-out/bin/zigttp-bench"

    echo "=== Microbenchmarks: $runtime ==="

    if [[ ! -x "$zigttp_bin" ]]; then
        echo "  zigttp not built, skipping (run: cd ../zigttp && zig build bench)"
        echo ""
        return
    fi

    set +e
    local output
    output=$("$zigttp_bin" --script "$SUITE_PATH" 2>/dev/null)
    local status=$?
    set -e

    if [[ $status -ne 0 && -z "$output" ]]; then
        echo "  Failed to run zigttp-bench"
        echo ""
        return
    fi

    if [[ -n "$output" ]]; then
        cat > "$RESULTS_DIR/microbench_${runtime}.json" <<EOF
{
    "type": "microbenchmark",
    "runtime": "$runtime",
    "benchmarks": $output,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "source": "zigttp-bench-script"
}
EOF
        echo "$output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for name, result in data.items():
    ops = result.get('ops_per_sec', 0)
    print(f\"  {name}: {ops:,.2f} ops/sec\")
"
    else
        echo "  Failed to parse zigttp-bench output"
    fi
    echo ""
}

echo "Microbenchmark Suite"
echo "Results: $RESULTS_DIR"
echo ""

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "node" ]]; then
    run_microbench "node" "node \"$SUITE_PATH\""
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "deno" ]]; then
    run_microbench "deno" "deno run --quiet \"$SUITE_PATH\""
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "bun" ]]; then
    BUN_BIN=""
    if command -v bun &> /dev/null; then
        BUN_BIN="$(command -v bun)"
    elif [[ -n "${BUN_INSTALL:-}" && -x "$BUN_INSTALL/bin/bun" ]]; then
        BUN_BIN="$BUN_INSTALL/bin/bun"
    elif [[ -x "$HOME/.bun/bin/bun" ]]; then
        BUN_BIN="$HOME/.bun/bin/bun"
    fi

    if [[ -n "$BUN_BIN" ]]; then
        run_microbench "bun" "\"$BUN_BIN\" run \"$SUITE_PATH\""
    else
        echo "Bun not installed, skipping"
    fi
fi

if [[ "$RUNTIME" == "all" || "$RUNTIME" == "zigttp" ]]; then
    run_zigttp_microbench
fi

echo "=== Microbenchmarks Complete ==="
