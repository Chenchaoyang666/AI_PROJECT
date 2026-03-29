#!/bin/zsh

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR" || exit 1

exit_code=0
node "$SCRIPT_DIR/run.mjs" "$@" || exit_code=$?

echo
if [ "$exit_code" -eq 0 ]; then
  echo "AI video starter finished."
else
  echo "AI video starter failed with status $exit_code."
fi

echo "Press Enter to close."
read -r

exit "$exit_code"
