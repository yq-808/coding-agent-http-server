#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  submit.sh "<prompt>"

Env:
  CODING_AGENT_HTTP_BASE_URL   default: http://127.0.0.1:8787
  CODING_AGENT_HTTP_TOKEN      optional bearer token
  CODING_AGENT_HTTP_PROVIDER   default: claude
  CODING_AGENT_HTTP_CWD        optional provider cwd
  CODING_AGENT_HTTP_MAX_TURNS  default: 1
EOF
  exit 2
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

prompt_raw="${1}"
provider_raw="${CODING_AGENT_HTTP_PROVIDER:-claude}"
cwd_raw="${CODING_AGENT_HTTP_CWD:-}"
max_turns_raw="${CODING_AGENT_HTTP_MAX_TURNS:-1}"

if ! [[ "${max_turns_raw}" =~ ^[0-9]+$ ]]; then
  echo "CODING_AGENT_HTTP_MAX_TURNS must be an integer." >&2
  exit 1
fi

prompt="$(json_escape "${prompt_raw}")"
provider="$(json_escape "${provider_raw}")"

options_json="{\"maxTurns\":${max_turns_raw}}"
if [[ -n "${cwd_raw}" ]]; then
  cwd="$(json_escape "${cwd_raw}")"
  options_json="{\"cwd\":\"${cwd}\",\"maxTurns\":${max_turns_raw}}"
fi

payload="{\"provider\":\"${provider}\",\"prompt\":\"${prompt}\",\"options\":${options_json}}"

auth=()
while IFS= read -r line; do
  auth+=("${line}")
done < <(auth_headers)

curl -sS -X POST "${BASE_URL}/v1/query" \
  "${auth[@]}" \
  -H 'Content-Type: application/json' \
  -d "${payload}"
echo

