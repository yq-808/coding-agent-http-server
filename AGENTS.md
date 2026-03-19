# AGENTS.md

## Session Trace Key Point

- When you need to review what a `coding-agent-http-server` session did, check:
  - `~/.coding-agent-http-server/sessions/<sessionId>.json`
- The full execution history is in `result.messages`.
- The final conclusion/result is in the last `type: "result"` entry (and usually also the last assistant text message).

## Quick Commands

- Locate a session file by id:
  - `rg -n "<sessionId>" ~/.coding-agent-http-server/sessions ~/.coding-agent-http-server/logs`
- Read top-level metadata:
  - `jq '{sessionId, provider, status, createdAt, startedAt, finishedAt}' ~/.coding-agent-http-server/sessions/<sessionId>.json`
