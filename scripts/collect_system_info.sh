#!/bin/bash
# Collect system information for benchmark context

set -euo pipefail

# Get OS info
OS=$(uname -s)
OS_VERSION=$(uname -r)
ARCH=$(uname -m)

# Get CPU info (macOS)
if [[ "$OS" == "Darwin" ]]; then
    CPU_MODEL=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")
    CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "unknown")
    RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
    RAM_GB=$((RAM_BYTES / 1024 / 1024 / 1024))
else
    # Linux fallback
    CPU_MODEL=$(cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | xargs || echo "unknown")
    CPU_CORES=$(nproc 2>/dev/null || echo "unknown")
    RAM_GB=$(free -g | awk '/Mem:/ {print $2}' 2>/dev/null || echo "unknown")
fi

# Get runtime versions
NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
DENO_VERSION=$(deno --version 2>/dev/null | head -1 | awk '{print $2}' || echo "not installed")
BUN_VERSION=$(bun --version 2>/dev/null || echo "not installed")

# Output JSON
cat <<EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "os": "$OS",
    "os_version": "$OS_VERSION",
    "arch": "$ARCH",
    "cpu_model": "$CPU_MODEL",
    "cpu_cores": $CPU_CORES,
    "ram_gb": $RAM_GB,
    "runtimes": {
        "node": "$NODE_VERSION",
        "deno": "$DENO_VERSION",
        "bun": "$BUN_VERSION"
    }
}
EOF
