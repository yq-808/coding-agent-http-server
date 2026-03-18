# Coding Agent HTTP Server

Generic HTTP server wrapper for local coding-agent SDK runtimes.

Current adapter support:
- `claude` via `@anthropic-ai/claude-agent-sdk`

Designed so additional providers (for example `codex`) can be added by implementing another adapter in `src/providers/`.

## Setup

```bash
cd /Users/yongqiwu/code/coding-agent-http-server
cp .env.example .env
npm install
```

For `claude`, make sure Claude CLI is installed and authenticated (`claude login`).
This server defaults `AGENT_DEFAULT_SETTING_SOURCES=user` so Claude user settings (for example custom auth headers) are loaded.
Default model is `claude-opus-4-6[1m]` (Opus with 1M context), configurable via `AGENT_DEFAULT_MODEL`.

## Run

```bash
npm run dev
# or
npm run build && npm start
```

Foreground terminal will print simple session lifecycle logs (`queued` / `running` / `completed` / `failed`).

## Session Storage

Session state is persisted on disk under:

```text
~/.coding-agent-http-server/sessions/<sessionId>.json
```

You can override root directory with `SESSION_STATE_DIR`.

## OpenClaw Skill

This repo ships an OpenClaw-installable skill at:

```text
skills/coding-agent-http-server/SKILL.md
```

To install as a shared local skill:

```bash
mkdir -p ~/.openclaw/skills
cp -R /Users/yongqiwu/code/coding-agent-http-server/skills/coding-agent-http-server \
  ~/.openclaw/skills/coding-agent-http-server
```

Or install as workspace skill:

```bash
mkdir -p <workspace>/skills
cp -R /Users/yongqiwu/code/coding-agent-http-server/skills/coding-agent-http-server \
  <workspace>/skills/coding-agent-http-server
```

The skill includes helper scripts:

- `scripts/submit.sh`
- `scripts/get-session.sh`
- `scripts/wait-session.sh`

## API (Pure Async)

### Health

```bash
curl http://127.0.0.1:8787/healthz
```

### Submit query (async)

```bash
curl -X POST http://127.0.0.1:8787/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "claude",
    "prompt": "Summarize current git status.",
    "options": {
      "cwd": "/Users/yongqiwu/code/openclaw",
      "maxTurns": 2
    }
  }'
```

Response example:

```json
{
  "sessionId": "f2d6b6dc-9ebd-4e2e-a6f8-6cbdfd11f0c1",
  "provider": "claude",
  "status": "queued",
  "queryUrl": "/v1/sessions/f2d6b6dc-9ebd-4e2e-a6f8-6cbdfd11f0c1"
}
```

### Query by session id

```bash
curl http://127.0.0.1:8787/v1/sessions/<sessionId>
```

- `status=queued|running|completed|failed`
- `completed` includes `result.messages` and `result.stderr`
- `failed` includes `error`

If `HTTP_AUTH_TOKEN` is set, include:

```bash
-H "Authorization: Bearer $HTTP_AUTH_TOKEN"
```
