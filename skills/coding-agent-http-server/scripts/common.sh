#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CODING_AGENT_HTTP_BASE_URL:-http://127.0.0.1:8787}"

auth_headers() {
  if [[ -n "${CODING_AGENT_HTTP_TOKEN:-}" ]]; then
    printf '%s\n' "-H" "Authorization: Bearer ${CODING_AGENT_HTTP_TOKEN}"
  fi
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "${value}"
}
