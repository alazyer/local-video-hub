#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "=========================================="
echo "[VERIFY] Running full feedback loop gate"
echo "[VERIFY] Project: $PROJECT_DIR"
echo "=========================================="

if bun run check:full; then
	echo "=========================================="
	echo "[VERIFY] PASS: check:full completed"
	echo "=========================================="
else
	echo "=========================================="
	echo "[VERIFY] FAIL: check:full failed"
	echo "=========================================="
	exit 1
fi
