#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  get-session.sh <sessionId>
EOF
  exit 2
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

session_id="$1"

auth=()
while IFS= read -r line; do
  auth+=("${line}")
done < <(auth_headers)

curl -sS "${BASE_URL}/v1/sessions/${session_id}" "${auth[@]}"
echo

