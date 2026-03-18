---
name: coding-agent-http-server
description: Submit async requests to a Coding Agent HTTP Server and fetch results by sessionId. Use when OpenClaw should delegate a coding task over HTTP (/v1/query + /v1/sessions/:sessionId).
homepage: https://github.com/yq-808/coding-agent-http-server
metadata: { "openclaw": { "requires": { "bins": ["curl"] } } }
---

# Coding Agent HTTP Server

Use this skill to call an async Coding Agent HTTP Server endpoint.

## Defaults

- Base URL: `http://127.0.0.1:8787`
- Submit endpoint: `POST /v1/query`
- Session endpoint: `GET /v1/sessions/:sessionId`
- Skill-level default `maxTurns`: `100` (set it in `options.maxTurns` when submitting)

Optional env vars:

- `CODING_AGENT_HTTP_BASE_URL` (default `http://127.0.0.1:8787`)
- `CODING_AGENT_HTTP_TOKEN` (Bearer token if server requires auth)

## Workflow

1. Submit request and get `sessionId`.
2. Poll session endpoint until status is `completed` or `failed`.
3. Read `result.messages` when completed.

## Submit (curl)

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
    "options": { "maxTurns": 100 }
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

## Query Session (curl)

```bash
BASE_URL="${CODING_AGENT_HTTP_BASE_URL:-http://127.0.0.1:8787}"
SESSION_ID="<uuid>"
AUTH=()
if [ -n "${CODING_AGENT_HTTP_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: Bearer ${CODING_AGENT_HTTP_TOKEN}")
fi

curl -sS "$BASE_URL/v1/sessions/$SESSION_ID" "${AUTH[@]}"
```

## Poll Until Done (curl)

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

- Keep prompts concise and task-focused for faster async turnaround.
- If `status=failed`, surface the `error` field and stop.
