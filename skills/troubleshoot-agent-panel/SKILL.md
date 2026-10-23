---
name: troubleshoot-agent-panel
description: Diagnose agent-panel ACP connection, permission, writable-root, and elicitation failures. Use when the panel stays empty, a write is rejected, or a question card never completes.
---

# Troubleshoot agent-panel

## The agent never connects

`GET /__agent/status` returns `{ connected, command }`. `connected` stays false until the first `POST /__agent/sessions`.

- The process must speak ACP on stdin/stdout. Claude Code and Codex need their ACP adapters (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`). Gemini uses `gemini --experimental-acp`.
- Run the same command in a terminal and confirm it stays up. A missing `npx` package or a login prompt on stderr looks like a hung panel.
- The HTTP bridge is loopback-only. A remote browser receives 403.
- Rebuild `@agent-panel/core` before using `mockAgentPath()`. The path points at `dist/mock-agent.js`.

## A write is rejected

The capability `writableRoots` are absolute paths after resolution from `cwd`. A path outside them, or a directory whose name only starts with the root (`sandbox-backup`), throws `path is outside writable roots` from `fs/write_text_file`.

`allowedTools` rejects a named tool before the card is shown. The demo agent asks for the tool name `write`. If that name is absent from `allowedTools`, the turn ends with `cancelled` and no card.

Permission cards wait on `POST /__agent/sessions/:id/respond` with `{ requestId, kind: 'permission', optionId }`. `optionId` must be one of the options the agent sent (`allow` / `reject` for the demo peer).

## A question never finishes

Question cards are ACP form elicitations. The respond body is `{ requestId, kind: 'question', action: 'accept', content: { tone: 'Direct' } }`. `action` may be `decline` or `cancel`. URL-mode elicitation is declined. The demo peer asks only when the prompt contains "ask me" or "clarify".

## The transcript disappeared

The server keeps the live turn in a memory buffer and replays it when the panel socket connects. A reload shows that turn again, including a permission or question that is still waiting, and the composer stays disabled until the turn stops. Restarting the dev server clears the buffer. ACP owns the agent session. There is no session file.
