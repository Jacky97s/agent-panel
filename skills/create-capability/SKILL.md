---
name: create-capability
description: Register an agent-panel capability with a system prompt, writable roots, allowed tools, context builders, and an on-complete hook. Use when a host feature should dispatch work to the shared ACP agent.
---

# Create a capability

A capability is one feature's contract with the agent. Register it on the server. The browser only sends an id, the user text, and a context object.

```ts
{
  id: 'note',
  label: 'Markdown note',
  systemPromptAppend: 'Edit the markdown note. Change only what the user asked.',
  writableRoots: [sandboxDir],
  allowedTools: ['write'],
  buildContext: (ctx) => [`note path: ${notePath}`, ctx.selection ? `Selected text:\n${ctx.selection}` : ''],
  onComplete: async ({ stopReason }) => {
    if (stopReason === 'end_turn') refreshNote();
  },
}
```

Rules:

- `id` matches `/^[a-z0-9][a-z0-9_-]{0,63}$/i`.
- `writableRoots` are resolved from `cwd`. `fs/read_text_file` and `fs/write_text_file` throw when the path is outside those roots, including a lookalike prefix such as `sandbox-backup` next to `sandbox`.
- `allowedTools` lists tool names the user may be asked to approve. Any other named tool is rejected. A missing name still asks. Roots are the file-system guard either way.
- `buildContext` receives `{ selection, file, element, state }` plus any other JSON the button sent. ACP has no separate system channel, so the prompt is the capability text, the context lines, then the user text, wrapped in `<agent-panel-capability>`.
- `onComplete` runs on the server after the ACP turn stops. The browser also receives `{ type: 'result', stopReason }`. Use the hook to refresh server state and the result event to reload the page.

Dispatch from any button:

```tsx
const note = useCapability('note');
await note.run('Tighten the note.', { selection, file: 'sandbox/note.md' });
```

Or render `<AgentAction capability="note" context={{ selection }} prompt="Tighten the note.">Revise</AgentAction>`.

Question cards come from ACP `elicitation/create` form mode (string enums become choices). Permission cards come from `session/request_permission`. The panel posts the answer to `POST /__agent/sessions/:id/respond` with `{ requestId, kind: 'question' | 'permission', ... }`.
