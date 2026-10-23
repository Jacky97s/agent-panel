---
name: integrate-agent-panel
description: Mount the agent-panel server and React panel so a host app can hand feature work to an ACP agent. Use when installing agent-panel, adding the Vite plugin, or rendering AgentPanelRoot, AgentDock, and AgentAction.
---

# Integrate agent-panel

agent-panel is the capability layer on top of the Agent Client Protocol. The ACP agent owns the session. This package decides which files a feature may touch, which tools it may approve, and how host context is attached to a prompt.

## Install

```bash
pnpm add @agent-panel/core @agent-panel/server @agent-panel/react
```

The server speaks ACP with `@agentclientprotocol/sdk`. Point it at an ACP command. For a local demo with no model, spawn the built-in peer:

```ts
import { mockAgentPath } from '@agent-panel/core/acp';
import { agentPanel } from '@agent-panel/server/vite';

agentPanel({
  cwd: process.cwd(),
  writableRoots: ['sandbox'],
  agent: { command: process.execPath, args: [mockAgentPath()] },
  capabilities: [],
});
```

`agent` is either `{ command, args }` (stdio ACP process) or `{ app }` (an in-process `AgentApp`, useful in tests). Presets for real agents live in `ACP_PRESETS` from `@agent-panel/core/acp`: `claude-code`, `codex`, and `gemini`. See `connect-acp-agent`.

## Render the panel

```tsx
import { AgentAction, AgentDock, AgentPanelRoot } from '@agent-panel/react';
import '@agent-panel/react/styles.css';

export function App() {
  return (
    <AgentPanelRoot>
      <AgentAction capability="note" prompt="Tighten the note.">
        Revise
      </AgentAction>
      <AgentDock capabilityId="note" />
    </AgentPanelRoot>
  );
}
```

`AgentPanelRoot` opens a WebSocket at `/__agent/ws`. Commands go to `POST /__agent/sessions` and `POST /__agent/sessions/:id/messages`. The server is loopback-only unless `loopbackOnly: false`.

Theme the panel with the CSS variables on `.ap-root`: `--ap-bg`, `--ap-fg`, `--ap-muted`, `--ap-border`, `--ap-accent`, `--ap-accent-fg`, `--ap-surface`, `--ap-danger`, `--ap-width`.

## Skills

Copy `skills/` into the host repo, or run `pnpm exec agent-panel add-skills`. The command writes only `skills/`. It does not create `.claude/skills` or `.agents/skills`.
