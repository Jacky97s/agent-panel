import { AgentAction, AgentDock, AgentPanelRoot, useAgentState } from '@agent-panel/react';
import { useCallback, useEffect, useState } from 'react';

export function App() {
  return (
    <AgentPanelRoot>
      <Workspace />
    </AgentPanelRoot>
  );
}

function Workspace() {
  const panel = useAgentState();
  const [note, setNote] = useState('');
  const [selection, setSelection] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [mode, setMode] = useState<'note' | 'sandbox'>('note');
  const reload = useCallback(async () => {
    const [text, list] = await Promise.all([
      fetch('/api/note').then((res) => res.text()),
      fetch('/api/sandbox').then((res) => res.json() as Promise<{ files: string[] }>),
    ]);
    setNote(text);
    setFiles(list.files);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const results = panel.items.filter((item) => item.kind === 'result').length;
  useEffect(() => {
    if (results) void reload();
  }, [results, reload]);
  const capabilityId = mode === 'note' ? 'note' : 'sandbox-file';

  return (
    <main className="workspace">
      <header>
        <h1>agent-panel</h1>
        <p>
          Two features share one panel. Each one registers a capability and talks to an ACP agent.
        </p>
      </header>
      <div className="modes">
        <button type="button" aria-pressed={mode === 'note'} onClick={() => setMode('note')}>
          Note
        </button>
        <button type="button" aria-pressed={mode === 'sandbox'} onClick={() => setMode('sandbox')}>
          Sandbox
        </button>
      </div>
      {mode === 'note' ? (
        <section>
          <textarea
            aria-label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onSelect={(event) => {
              const el = event.currentTarget;
              setSelection(el.value.slice(el.selectionStart, el.selectionEnd));
            }}
          />
          <div className="row">
            <AgentAction
              capability="note"
              context={{ selection, file: 'sandbox/note.md' }}
              prompt={
                selection
                  ? `Revise this selection:\n${selection}`
                  : 'Tighten the note and keep it short.'
              }
            >
              Ask the agent to revise the note
            </AgentAction>
            <AgentAction
              capability="note"
              context={{ file: 'sandbox/note.md' }}
              prompt="Ask me which tone to use before you edit."
            >
              Ask the agent to clarify
            </AgentAction>
          </div>
        </section>
      ) : (
        <section>
          <ul>
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
          <AgentAction
            capability="sandbox-file"
            prompt="Generate a short text file in the sandbox."
          >
            Ask the agent to generate a file
          </AgentAction>
        </section>
      )}
      <AgentDock
        capabilityId={capabilityId}
        context={
          mode === 'note'
            ? { selection, file: 'sandbox/note.md' }
            : { file: 'sandbox/generated.txt' }
        }
      />
    </main>
  );
}
