#!/usr/bin/env bash

set -euo pipefail

CODEX_DIR="${CODEX_DIR:-$HOME/.codex}"
WITH_LOGS=0

usage() {
    cat <<'EOF'
Usage: clean-codex-home.sh [--with-logs]

Conservative cleanup for ~/.codex:
- always removes temp files, caches, shell snapshots, and .DS_Store files
- optionally removes logs_1.sqlite* when --with-logs is provided

Options:
  --with-logs  Also remove ~/.codex/logs_1.sqlite and its WAL/SHM files
  -h, --help   Show this help message
EOF
}

human_size() {
    local kb="$1"
    awk -v kb="$kb" '
        function abs(v) { return v < 0 ? -v : v }
        BEGIN {
            split("KB MB GB TB", units, " ")
            size = kb + 0
            unit = 1
            while (size >= 1024 && unit < 4) {
                size /= 1024
                unit++
            }
            if (unit == 1) {
                printf "%d %s", int(size + 0.5), units[unit]
            } else {
                printf "%.1f %s", size, units[unit]
            }
        }
    '
}

measure_kb() {
    local path="$1"
    if [[ -e "$path" ]]; then
        du -sk "$path" 2>/dev/null | awk '{print $1}'
    else
        echo 0
    fi
}

for arg in "$@"; do
    case "$arg" in
        --with-logs)
            WITH_LOGS=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            echo >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ ! -d "$CODEX_DIR" ]]; then
    echo "Codex directory not found: $CODEX_DIR" >&2
    exit 1
fi

before_kb="$(measure_kb "$CODEX_DIR")"
ds_store_count="$(find "$CODEX_DIR" -name '.DS_Store' -print | wc -l | tr -d ' ')"

targets=(
    "$CODEX_DIR/.tmp"
    "$CODEX_DIR/tmp"
    "$CODEX_DIR/cache"
    "$CODEX_DIR/shell_snapshots"
    "$CODEX_DIR/models_cache.json"
    "$CODEX_DIR/version.json"
)

if [[ "$WITH_LOGS" -eq 1 ]]; then
    targets+=(
        "$CODEX_DIR/logs_1.sqlite"
        "$CODEX_DIR/logs_1.sqlite-shm"
        "$CODEX_DIR/logs_1.sqlite-wal"
    )
fi

echo "Cleaning: $CODEX_DIR"
echo "Mode: conservative$([[ "$WITH_LOGS" -eq 1 ]] && printf ' + logs')"
if [[ "$WITH_LOGS" -eq 1 ]]; then
    echo "Note: deleting logs is best done after Codex is fully closed."
fi
echo

for target in "${targets[@]}"; do
    if [[ -e "$target" ]]; then
        echo "Removing $target"
        rm -rf "$target"
    else
        echo "Skipping $target (not found)"
    fi
done

if [[ "$ds_store_count" -gt 0 ]]; then
    find "$CODEX_DIR" -name '.DS_Store' -delete
fi

after_kb="$(measure_kb "$CODEX_DIR")"
freed_kb=$((before_kb - after_kb))
if (( freed_kb < 0 )); then
    freed_kb=0
fi

echo
echo "Cleanup finished."
echo "Freed: $(human_size "$freed_kb")"
echo "Before: $(human_size "$before_kb")"
echo "After:  $(human_size "$after_kb")"
echo ".DS_Store removed: $ds_store_count"
