---
name: coding-agent-http-server
description: Submit async requests to a Coding Agent HTTP Server and fetch results by sessionId. Use when OpenClaw should delegate a coding task over HTTP (/v1/query + /v1/sessions/:sessionId).
homepage: https://github.com/yq-808/coding-agent-http-server
metadata: { "openclaw": { "requires": { "bins": ["curl"] } } }
---

# Coding Agent HTTP Server

Use this skill to call an async Coding Agent HTTP Server endpoint.
Prefer using bundled scripts under `{baseDir}/scripts` so calls are consistent.

## Defaults

- Base URL: `http://127.0.0.1:8787`
- Submit endpoint: `POST /v1/query`
- Session endpoint: `GET /v1/sessions/:sessionId`

Optional env vars:

- `CODING_AGENT_HTTP_BASE_URL` (default `http://127.0.0.1:8787`)
- `CODING_AGENT_HTTP_TOKEN` (Bearer token if server requires auth)
- `CODING_AGENT_HTTP_POLL_VERBOSE=1` (poll script prints full JSON every cycle)

## Workflow

1. Submit request and get `sessionId`.
2. Poll session endpoint until status is `completed` or `failed`.
3. Read `result.messages` when completed.

## Script-first usage

Submit async query:

```bash
{baseDir}/scripts/submit.sh "Summarize current git status in 3 bullets."
```

Pass provider/cwd/max turns:

```bash
CODING_AGENT_HTTP_PROVIDER=claude \
CODING_AGENT_HTTP_CWD=/Users/yongqiwu/code/openclaw \
CODING_AGENT_HTTP_MAX_TURNS=1 \
{baseDir}/scripts/submit.sh "Summarize current git status in 3 bullets."
```

Poll to completion:

```bash
{baseDir}/scripts/wait-session.sh <sessionId>
```

Fetch session once:

```bash
{baseDir}/scripts/get-session.sh <sessionId>
```

## Raw curl fallback

```bash
BASE_URL="${CODING_AGENT_HTTP_BASE_URL:-http://127.0.0.1:8787}"
AUTH=()
if [ -n "${CODING_AGENT_HTTP_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer ${CODING_AGENT_HTTP_TOKEN}")
fi

curl -sS -X POST "$BASE_URL/v1/query" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "claude",
    "prompt": "Summarize current git status in 3 bullets.",
    "options": { "maxTurns": 1 }
  }'
```

Expected response shape:

```json
{
  "sessionId": "<uuid>",
  "provider": "claude",
  "status": "queued",
  "queryUrl": "/v1/sessions/<uuid>"
}
```

## Raw poll by sessionId

```bash
BASE_URL="${CODING_AGENT_HTTP_BASE_URL:-http://127.0.0.1:8787}"
SESSION_ID="<uuid>"
AUTH=()
if [ -n "${CODING_AGENT_HTTP_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer ${CODING_AGENT_HTTP_TOKEN}")
fi

while true; do
  RESP=$(curl -sS "$BASE_URL/v1/sessions/$SESSION_ID" "${AUTH[@]}")
  echo "$RESP"

  STATUS=$(
    printf '%s' "$RESP" \
      | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | head -n 1 \
      | sed -n 's/"status"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/p'
  )
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    break
  fi
  sleep 2
done
```

## Notes for OpenClaw agents

- Prefer `stream: false` so status/result JSON is easy to parse.
- Keep prompts concise and task-focused for faster async turnaround.
- If `status=failed`, surface the `error` field and stop.
