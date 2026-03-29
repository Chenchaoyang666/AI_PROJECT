#!/usr/bin/env bash
# check-symlink-skills.sh
# Usage: ./check-symlink-skills.sh <skills-directory>
# Shows which skills in the directory are symlinks and where they point to.

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <skills-directory>"
    exit 1
fi

SKILLS_DIR="$1"

if [[ ! -d "$SKILLS_DIR" ]]; then
    echo "Error: '$SKILLS_DIR' is not a directory"
    exit 1
fi

symlink_count=0
total_count=0

echo "Scanning: $SKILLS_DIR"
echo ""
printf "%-30s %s\n" "SKILL" "TARGET"
printf "%-30s %s\n" "-----" "------"

for entry in "$SKILLS_DIR"/*/; do
    [[ -e "$entry" || -L "$entry" ]] || continue

    name=$(basename "$entry")

    # skip hidden directories
    [[ "$name" == .* ]] && continue

    total_count=$((total_count + 1))

    if [[ -L "${entry%/}" ]]; then
        target=$(readlink "${entry%/}")
        # resolve to absolute path
        abs_target=$(cd "$(dirname "${entry%/}")" && cd "$target" 2>/dev/null && pwd || echo "$target (unresolvable)")
        printf "%-30s -> %s\n" "$name" "$abs_target"
        symlink_count=$((symlink_count + 1))
    fi
done

echo ""
echo "Result: $symlink_count symlink(s) out of $total_count skill(s)"
