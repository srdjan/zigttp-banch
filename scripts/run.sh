#!/bin/bash
# Main benchmark orchestration script
# Usage: ./run.sh [mode] [runtime] [connections]
#   mode: full|http|microbench|coldstart|memory|quick
#   runtime: all|deno|zigttp
#   connections: number of concurrent connections for HTTP tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_DIR/results/$(date +%Y%m%d_%H%M%S)_$$_$RANDOM"

MODE="${1:-full}"
RUNTIME="${2:-all}"
CONNECTIONS="${3:-10}"

mkdir -p "$RESULTS_DIR"

echo "========================================"
echo "  zigttp Benchmark Suite"
echo "========================================"
echo "Mode: $MODE"
echo "Runtime: $RUNTIME"
echo "Connections: $CONNECTIONS"
echo "Results: $RESULTS_DIR"
echo ""

# Collect system info
echo "Collecting system info..."
"$SCRIPT_DIR/collect_system_info.sh" > "$RESULTS_DIR/system_info.json"

# Copy versions
cp "$PROJECT_DIR/versions.json" "$RESULTS_DIR/"

case "$MODE" in
    quick)
        # Quick validation run
        echo ""
        echo "=== Quick Validation ==="
        "$SCRIPT_DIR/run_http.sh" "$RESULTS_DIR" "$RUNTIME" 1
        ;;
    http)
        echo ""
        "$SCRIPT_DIR/run_http.sh" "$RESULTS_DIR" "$RUNTIME" "$CONNECTIONS"
        ;;
    microbench)
        echo ""
        RESULTS_DIR="$RESULTS_DIR" "$SCRIPT_DIR/run_microbench.sh" "$RUNTIME"
        ;;
    coldstart)
        echo ""
        "$SCRIPT_DIR/run_coldstart.sh" "$RESULTS_DIR" "$RUNTIME" 50
        ;;
    memory)
        echo ""
        "$SCRIPT_DIR/run_memory.sh" "$RESULTS_DIR" "$RUNTIME"
        ;;
    full)
        echo ""
        "$SCRIPT_DIR/run_http.sh" "$RESULTS_DIR" "$RUNTIME" "$CONNECTIONS"
        echo ""
        RESULTS_DIR="$RESULTS_DIR" "$SCRIPT_DIR/run_microbench.sh" "$RUNTIME"
        echo ""
        "$SCRIPT_DIR/run_coldstart.sh" "$RESULTS_DIR" "$RUNTIME" 50
        echo ""
        "$SCRIPT_DIR/run_memory.sh" "$RESULTS_DIR" "$RUNTIME"
        ;;
    *)
        echo "Unknown mode: $MODE"
        echo "Usage: $0 [full|http|microbench|coldstart|memory|quick] [runtime] [connections]"
        exit 1
        ;;
esac

echo ""
echo "========================================"
echo "  Benchmark Complete"
echo "========================================"
echo "Results saved to: $RESULTS_DIR"
echo ""

# Generate summary
if [[ -f "$PROJECT_DIR/analysis/analyze.py" ]]; then
    echo "Generating analysis report..."
    python3 "$PROJECT_DIR/analysis/analyze.py" --results-dir "$RESULTS_DIR" --output "$RESULTS_DIR/report.md" 2>/dev/null || echo "Analysis script not ready"
fi
