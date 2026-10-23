---
name: connect-acp-agent
description: Point agent-panel at Claude Code, Codex, Gemini CLI, or another local ACP agent. Use when choosing an agent command, switching presets, or replacing the built-in demo peer.
---

# Connect an ACP agent

agent-panel does not implement Claude or Codex. It spawns a process that already speaks the Agent Client Protocol and drives it with `@agentclientprotocol/sdk`.

```ts
import { ACP_PRESETS } from '@agent-panel/core/acp';

agentPanel({
  cwd: process.cwd(),
  agent: ACP_PRESETS['claude-code'],
  capabilities,
});
```

Presets:

| Key | Command |
| --- | --- |
| `claude-code` | `npx -y @agentclientprotocol/claude-agent-acp` |
| `codex` | `npx -y @agentclientprotocol/codex-acp` |
| `gemini` | `gemini --experimental-acp` |

Any other stdio agent is `{ command, args }`. The working directory is the server `cwd`. The client advertises `fs.readTextFile`, `fs.writeTextFile`, and form elicitation, then calls `initialize`, `session/new`, and `session/prompt`.

The built-in demo peer is `mockAgentPath()` from `@agent-panel/core/acp`. It is an ACP agent with no model: it asks a tone question when the prompt says "ask me", and it writes through the client filesystem after `session/request_permission`. Use it for the example and for tests. Replace it with a preset before expecting a real model.

`@tutti-os/agent-acp-kit` can detect and launch many local agents. This package does not depend on it. If you already use the kit, pass the command it would spawn as `agent`.

Auth, model choice, and account login stay with the agent CLI. agent-panel only forwards prompts, permission decisions, and elicitation answers.
