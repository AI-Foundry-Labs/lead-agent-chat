#!/usr/bin/env bash
# Usage:
#   ./eval_harness/run-tests.sh           # all tests
#   ./eval_harness/run-tests.sh unit      # unit only
#   ./eval_harness/run-tests.sh smoke     # smoke (needs server on :3000)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="$ROOT/eval_harness"
MODE="${1:-all}"
PASS=0
FAIL=0

run_suite() {
  local label="$1"
  local pattern="$2"
  echo ""
  echo "━━━ $label ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  # node:test runner with tsx CJS loader (avoids ESM cycle issues in Node 22)
  if node --require tsx/cjs --test $pattern 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
}

cd "$ROOT"

if [[ "$MODE" == "all" || "$MODE" == "unit" ]]; then
  run_suite "Unit: Calendar / Timezone"       "$HARNESS/unit/calendar-timezone.test.ts"
  run_suite "Unit: Thread Message Filter"     "$HARNESS/unit/thread-message-filter.test.ts"
  run_suite "Unit: Lead Status Guard"         "$HARNESS/unit/lead-status-guard.test.ts"
  run_suite "Unit: Conversation Access"       "$HARNESS/unit/conversation-access-logic.test.ts"
fi

if [[ "$MODE" == "all" || "$MODE" == "smoke" ]]; then
  SERVER="${SERVER_URL:-http://localhost:3000}"
  if ! curl -sf "$SERVER/api/health" >/dev/null 2>&1 && \
     ! curl -sf "$SERVER" >/dev/null 2>&1; then
    echo ""
    echo "⚠  Smoke tests skipped — no server at $SERVER"
    echo "   Start the dev server first: npm run dev"
  else
    run_suite "Smoke: API Endpoints"   "$HARNESS/smoke/api-endpoints.test.ts"
    run_suite "Smoke: Auth / Cookies"  "$HARNESS/smoke/auth-cookie.test.ts"
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Suites passed: $PASS  |  Failed: $FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[[ "$FAIL" -eq 0 ]]
