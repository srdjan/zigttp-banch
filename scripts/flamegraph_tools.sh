#!/bin/bash
# Shared flamegraph tool resolution for profiling scripts.
# Source this file after setting PROJECT_DIR.
#
# Provides:
#   ensure_flamegraph_tools <mode>  - sets FLAMEGRAPH_BIN and STACKCOLLAPSE_BIN
#   detect_profile_method           - sets PROFILE_METHOD based on OS
#
# Expects:
#   PROJECT_DIR - path to zigttp-bench root

FLAMEGRAPH_DIR="${FLAMEGRAPH_DIR:-$PROJECT_DIR/tools/FlameGraph}"
FLAMEGRAPH_BIN=""
STACKCOLLAPSE_BIN=""

ensure_flamegraph_tools() {
    local mode=$1

    if command -v flamegraph.pl &> /dev/null; then
        FLAMEGRAPH_BIN="$(command -v flamegraph.pl)"
    fi

    if [[ "$mode" == "sample" ]]; then
        if command -v stackcollapse-sample.awk &> /dev/null; then
            STACKCOLLAPSE_BIN="$(command -v stackcollapse-sample.awk)"
        fi
    else
        if command -v stackcollapse-perf.pl &> /dev/null; then
            STACKCOLLAPSE_BIN="$(command -v stackcollapse-perf.pl)"
        fi
    fi

    if [[ -n "$FLAMEGRAPH_BIN" && -n "$STACKCOLLAPSE_BIN" ]]; then
        return 0
    fi

    if [[ ! -d "$FLAMEGRAPH_DIR" ]]; then
        echo "Fetching FlameGraph tools..."
        git clone --depth 1 https://github.com/brendangregg/FlameGraph "$FLAMEGRAPH_DIR"
    fi

    FLAMEGRAPH_BIN="$FLAMEGRAPH_DIR/flamegraph.pl"
    if [[ "$mode" == "sample" ]]; then
        STACKCOLLAPSE_BIN="$FLAMEGRAPH_DIR/stackcollapse-sample.awk"
    else
        STACKCOLLAPSE_BIN="$FLAMEGRAPH_DIR/stackcollapse-perf.pl"
    fi
}

detect_profile_method() {
    local os_name
    os_name="$(uname -s)"

    if [[ "$os_name" == "Darwin" ]]; then
        PROFILE_METHOD="sample"
    elif [[ "$os_name" == "Linux" ]]; then
        PROFILE_METHOD="perf"
    else
        echo "Unsupported OS for profiling: $os_name"
        exit 1
    fi
}
