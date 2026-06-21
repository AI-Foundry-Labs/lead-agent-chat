#!/usr/bin/env bash
# Usage:
#   ./eval_harness/run-tests.sh           # all tests (unit + agent + llm + smoke)
#   ./eval_harness/run-tests.sh unit      # unit only
#   ./eval_harness/run-tests.sh agent     # agent schema/logic tests (no LLM)
#   ./eval_harness/run-tests.sh llm       # real LLM call contracts (needs API key)
#   ./eval_harness/run-tests.sh smoke     # smoke (needs server on :3000)
#
# LLM contract tests skip gracefully when no API key is found.
# Set LLM_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or AI_GATEWAY_API_KEY.
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

# LLM contract tests use --import tsx (universal loader) so that @/ path aliases
# in source modules are resolved correctly when they load as ES modules.
run_llm_suite() {
  local label="$1"
  local pattern="$2"
  echo ""
  echo "━━━ $label ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if node --import tsx --test $pattern 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
}

cd "$ROOT"

# Load env files for LLM keys (.env first, .env.local overrides).
# Uses line-by-line parsing instead of source to handle values with spaces/special chars.
load_env_file() {
  local file="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue   # skip comments
    [[ -z "${line//[[:space:]]/}" ]] && continue  # skip blank lines
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
    fi
  done < "$file"
}
for envfile in "$ROOT/.env" "$ROOT/.env.local"; do
  [[ -f "$envfile" ]] && load_env_file "$envfile"
done

if [[ "$MODE" == "all" || "$MODE" == "unit" ]]; then
  run_suite "Unit: Calendar / Timezone"             "$HARNESS/unit/calendar-timezone.test.ts"
  run_suite "Unit: Thread Message Filter"           "$HARNESS/unit/thread-message-filter.test.ts"
  run_suite "Unit: Lead Status Guard"               "$HARNESS/unit/lead-status-guard.test.ts"
  run_suite "Unit: Conversation Access"             "$HARNESS/unit/conversation-access-logic.test.ts"
  run_suite "Unit: Route Group Message Classify"    "$HARNESS/unit/route-group-message-classify.test.ts"
  run_suite "Unit: Verify Agency Group"             "$HARNESS/unit/verify-agency-group.test.ts"
  run_suite "Unit: Lead Topics Title Builders"      "$HARNESS/unit/lead-topics-title-builders.test.ts"
  run_suite "Unit: Group Send Queue Drop Policy"    "$HARNESS/unit/group-send-queue-drop-policy.test.ts"
  run_suite "Unit: Agency Host Resolution"          "$HARNESS/unit/agency-host-resolution.test.ts"
  run_suite "Unit: Staff Report Fallback"           "$HARNESS/unit/staff-report-fallback.test.ts"
  run_suite "Unit: Render Template"                 "$HARNESS/unit/render-template.test.ts"
  run_suite "Unit: Paris Time"                      "$HARNESS/unit/paris-time.test.ts"
fi

if [[ "$MODE" == "all" || "$MODE" == "agent" ]]; then
  run_suite "Agent: Lead Prompt"              "$HARNESS/agent/prompt-construction/lead-system-prompt.test.ts"
  run_suite "Agent: Operator Prompt"          "$HARNESS/agent/prompt-construction/operator-system-prompt.test.ts"
  run_suite "Agent: Lead Tool Logic"          "$HARNESS/agent/tool-behavior/lead-tool-logic.test.ts"
  run_suite "Agent: Operator Tool Schemas"    "$HARNESS/agent/tool-behavior/operator-tool-schemas.test.ts"
  run_suite "Agent: Main Assistant Schemas"   "$HARNESS/agent/tool-behavior/main-assistant-tool-schemas.test.ts"
  run_suite "Agent: Thread Turns"             "$HARNESS/agent/thread-pipeline/thread-turns.test.ts"
  run_suite "Agent: Thread Summary Schema"    "$HARNESS/agent/thread-pipeline/thread-summary-schema.test.ts"
  run_suite "Agent: Cross-Thread Context"     "$HARNESS/agent/memory/cross-thread-context.test.ts"
  run_suite "Agent: Memory Constants"         "$HARNESS/agent/memory/memory-constants.test.ts"
  run_suite "Agent: Handoff Rule Matcher"     "$HARNESS/agent/rules/handoff-rule-matcher.test.ts"
fi

if [[ "$MODE" == "all" || "$MODE" == "llm" ]]; then
  run_llm_suite "LLM: Detect Language"          "$HARNESS/agent/llm-contracts/detect-lang.test.ts"
  run_llm_suite "LLM: Rule Matcher"             "$HARNESS/agent/llm-contracts/rule-matcher.test.ts"
  run_llm_suite "LLM: Summarize Thread"         "$HARNESS/agent/llm-contracts/summarize-thread.test.ts"
  run_llm_suite "LLM: Lead Conversation Flow"   "$HARNESS/agent/llm-contracts/lead-conversation-flow.test.ts"
  run_llm_suite "LLM: Admin Conversation Flow"  "$HARNESS/agent/llm-contracts/admin-conversation-flow.test.ts"
  run_llm_suite "LLM: Staff Report"             "$HARNESS/agent/llm-contracts/staff-report.test.ts"
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
