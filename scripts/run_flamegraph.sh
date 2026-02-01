#!/bin/bash
# Generate a flamegraph for zigttp microbench (default: httpHandlerHeavy).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_BASE="$PROJECT_DIR/results"

RESULTS_DIR="${RESULTS_DIR:-}"
if [[ -z "$RESULTS_DIR" ]]; then
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

ensure_unique_results_dir
mkdir -p "$RESULTS_DIR"

PROFILE_SECONDS="${PROFILE_SECONDS:-15}"
BENCH_FILTER="${BENCH_FILTER:-httpHandlerHeavy}"

if [[ -z "${BENCH_WARMUP_ITERATIONS:-}" ]]; then
    BENCH_WARMUP_ITERATIONS=20
fi
if [[ -z "${BENCH_MEASURED_ITERATIONS:-}" ]]; then
    BENCH_MEASURED_ITERATIONS=200
fi
if [[ -z "${BENCH_WARMUP_MS:-}" ]]; then
    BENCH_WARMUP_MS=200
fi
if [[ -z "${BENCH_MAX_MEASURED_TOTAL_MS:-}" ]]; then
    BENCH_MAX_MEASURED_TOTAL_MS=20000
fi

MICROBENCH_DIR="$PROJECT_DIR/microbench"
SUITE_PATH="$RESULTS_DIR/microbench_suite.js"

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

# Accept ZIGTTP_DIR (preferred) or legacy ZIGTP_PROJECT_DIR
ZIGTTP_DIR="${ZIGTTP_DIR:-${ZIGTP_PROJECT_DIR:-$PROJECT_DIR/../zigttp}}"
ZIGTTP_BUILD_FLAGS="${ZIGTTP_BUILD_FLAGS:-${ZIGTP_BUILD_FLAGS:--Doptimize=ReleaseFast}}"
ZIGTTP_AUTO_RELEASE_BUILD="false"

if [[ -z "${ZIGTTP_BIN:-}" ]]; then
    ZIGTTP_BIN="$ZIGTTP_DIR/zig-out/bin/zigttp-bench"
    ZIGTTP_AUTO_RELEASE_BUILD="true"
fi

build_zigttp_bench_release() {
    if [[ -n "${ZIGTTP_SKIP_RELEASE_BUILD:-${ZIGTP_SKIP_RELEASE_BUILD:-}}" ]]; then
        return
    fi

    if ! command -v zig &> /dev/null; then
        echo "zig not found; install Zig to build zigttp-bench"
        exit 1
    fi

    echo "Building zigttp-bench release (bench $ZIGTTP_BUILD_FLAGS)"
    (
        cd "$ZIGTTP_DIR"
        zig build bench $ZIGTTP_BUILD_FLAGS
    )
}

if [[ "$ZIGTTP_AUTO_RELEASE_BUILD" == "true" ]]; then
    build_zigttp_bench_release
fi

if [[ ! -x "$ZIGTTP_BIN" ]]; then
    echo "zigttp-bench not found at $ZIGTTP_BIN"
    echo "Build it first: cd ../zigttp && zig build bench $ZIGTTP_BUILD_FLAGS"
    exit 1
fi

# Shared flamegraph tools (ensure_flamegraph_tools, detect_profile_method)
source "$SCRIPT_DIR/flamegraph_tools.sh"

PROFILE_METHOD="${PROFILE_METHOD:-}"
if [[ -z "$PROFILE_METHOD" ]]; then
    detect_profile_method
fi

ensure_flamegraph_tools "$PROFILE_METHOD"

BENCH_OUTPUT="$RESULTS_DIR/microbench_zigttp_raw.json"
FOLDED_OUT="$RESULTS_DIR/stacks.folded"
SVG_OUT="$RESULTS_DIR/flamegraph.svg"

echo "Flamegraph run (zigttp)"
echo "Results: $RESULTS_DIR"
echo "Profile method: $PROFILE_METHOD"
echo ""

if [[ "$PROFILE_METHOD" == "sample" ]]; then
    SAMPLE_OUT="$RESULTS_DIR/sample.txt"
    "$ZIGTTP_BIN" --script "$SUITE_PATH" > "$BENCH_OUTPUT" 2>/dev/null &
    bench_pid=$!
    sleep 0.2
    sample "$bench_pid" "$PROFILE_SECONDS" -file "$SAMPLE_OUT" >/dev/null 2>&1 || true
    wait "$bench_pid"

    awk -f "$STACKCOLLAPSE_BIN" "$SAMPLE_OUT" > "$FOLDED_OUT"
    "$FLAMEGRAPH_BIN" "$FOLDED_OUT" > "$SVG_OUT"
else
    PERF_DATA="$RESULTS_DIR/perf.data"
    PERF_SCRIPT_OUT="$RESULTS_DIR/perf.script"
    if ! command -v perf &> /dev/null; then
        echo "perf not found; install perf or use PROFILE_METHOD=sample on macOS"
        exit 1
    fi
    perf record -F 99 -g -o "$PERF_DATA" -- "$ZIGTTP_BIN" --script "$SUITE_PATH" > "$BENCH_OUTPUT" 2>/dev/null
    perf script -i "$PERF_DATA" > "$PERF_SCRIPT_OUT"
    "$STACKCOLLAPSE_BIN" "$PERF_SCRIPT_OUT" > "$FOLDED_OUT"
    "$FLAMEGRAPH_BIN" "$FOLDED_OUT" > "$SVG_OUT"
fi

if [[ -n "$BENCH_OUTPUT" && -s "$BENCH_OUTPUT" ]]; then
    cat > "$RESULTS_DIR/microbench_zigttp.json" <<EOF
{
    "type": "microbenchmark",
    "runtime": "zigttp",
    "benchmarks": $(cat "$BENCH_OUTPUT"),
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "source": "zigttp-bench-script"
}
EOF
    echo ""
    echo "=== zigttp microbench ==="
    if command -v jq &> /dev/null; then
        cat "$BENCH_OUTPUT" | jq -r 'to_entries[] | "  \(.key): \(.value.ops_per_sec // 0 | floor) ops/sec"'
    else
        # Fallback: simple grep-based parsing
        cat "$BENCH_OUTPUT" | grep -oE '"[^"]+"\s*:\s*\{[^}]*"ops_per_sec"\s*:\s*[0-9.]+' | \
            sed 's/.*"\([^"]*\)".*"ops_per_sec"\s*:\s*\([0-9.]*\).*/  \1: \2 ops\/sec/'
    fi
fi

echo ""
echo "Flamegraph written to: $SVG_OUT"
