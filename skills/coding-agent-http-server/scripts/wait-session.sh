#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  wait-session.sh <sessionId> [intervalSeconds]
EOF
  exit 2
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

session_id="$1"
interval="${2:-2}"
verbose="${CODING_AGENT_HTTP_POLL_VERBOSE:-0}"

if ! [[ "${interval}" =~ ^[0-9]+$ ]]; then
  echo "intervalSeconds must be an integer." >&2
  exit 1
fi

auth=()
while IFS= read -r line; do
  auth+=("${line}")
done < <(auth_headers)

while true; do
  resp="$(curl -sS "${BASE_URL}/v1/sessions/${session_id}" "${auth[@]}")"

  # Extract the first "status" field (top-level session status).
  status="$(
    printf '%s' "${resp}" \
      | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | head -n 1 \
      | sed -n 's/"status"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/p'
  )"

  if [[ -z "${status}" ]]; then
    echo "${resp}"
    echo "Unable to parse status from response." >&2
    exit 1
  fi

  if [[ "${status}" == "completed" || "${status}" == "failed" ]]; then
    echo "${resp}"
    break
  fi

  if [[ "${verbose}" == "1" ]]; then
    echo "${resp}"
  else
    printf '{"sessionId":"%s","status":"%s"}\n' "${session_id}" "${status}"
  fi

  sleep "${interval}"
done
