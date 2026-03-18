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

## Run

```bash
npm run dev
# or
npm run build && npm start
```

## API

Health:

```bash
curl http://127.0.0.1:8787/healthz
```

Query (SSE by default):

```bash
curl -N -X POST http://127.0.0.1:8787/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "claude",
    "prompt": "Summarize current git status.",
    "options": {
      "cwd": "/Users/yongqiwu/code/openclaw",
      "allowedTools": ["Read", "Bash", "Grep"],
      "maxTurns": 2
    }
  }'
```

Non-stream:

```bash
curl -X POST http://127.0.0.1:8787/v1/query \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "claude",
    "prompt": "Say hello in one sentence.",
    "stream": false
  }'
```

If `HTTP_AUTH_TOKEN` is set, include:

```bash
-H "Authorization: Bearer $HTTP_AUTH_TOKEN"
```
