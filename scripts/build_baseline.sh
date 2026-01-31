#!/bin/bash
# Build baseline zigttp without embedded bytecode (for comparison)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ZIGTTP_DIR="${ZIGTTP_DIR:-$PROJECT_DIR/../zigttp}"

echo "Building Baseline zigttp Server"
echo "================================"
echo ""
echo "Config:"
echo "  zigttp dir: $ZIGTTP_DIR"
echo ""

if [[ ! -d "$ZIGTTP_DIR" ]]; then
    echo "Error: zigttp directory not found at $ZIGTTP_DIR"
    echo "Set ZIGTTP_DIR environment variable to override"
    exit 1
fi

# Build without embedded bytecode
echo "Step 1: Building server (runtime handler loading)..."
(
    cd "$ZIGTTP_DIR"
    zig build -Doptimize=ReleaseFast
)

# Strip symbols
echo ""
echo "Step 2: Stripping debug symbols..."
strip "$ZIGTTP_DIR/zig-out/bin/zigttp-server"

# Show results
echo ""
echo "Build complete!"
echo ""
echo "Binary info:"
ls -lh "$ZIGTTP_DIR/zig-out/bin/zigttp-server"
echo ""
echo "Usage:"
echo "  $ZIGTTP_DIR/zig-out/bin/zigttp-server -p 8080 handlers/zigttp/handler.js"
echo ""
echo "Note: Handler file argument required (no embedded bytecode)"
