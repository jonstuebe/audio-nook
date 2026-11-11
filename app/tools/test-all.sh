#!/bin/sh
# Every test file on both hosts: web, macOS under the agent's chrome, and macOS under the
# platform's (the real sidebar and toolbar), plus the window checks a test cannot make.
# Run from app/; it rebuilds what is stale first. Exits non-zero if anything fails.
set -u
cd "$(dirname "$0")/.."
EXACT=${EXACT2:-../../exact}
export EXACT_APP_DIR="$(pwd)"
status=0
bun exact.mjs web-build >/dev/null || status=1
bun exact.mjs mac >/dev/null || status=1
for f in *.test.contract; do
  for run in "web" "macos" "macos --chrome platform"; do
    echo "== $run $f"
    out=$(cd "$EXACT" && bun scripts/agent.mjs $run --app app --test "$EXACT_APP_DIR/$f" 2>&1) || status=1
    printf '%s\n' "$out" | grep -v '^exact:' | grep -E '^test |passed|failed|^  '
    printf '%s\n' "$out" | grep -q 'FAIL' && status=1
  done
done
echo "== tools/check-sidebar.mjs"
bun tools/check-sidebar.mjs > /tmp/check-sidebar.$$ 2>&1 || status=1
tail -1 /tmp/check-sidebar.$$; rm -f /tmp/check-sidebar.$$
exit $status
