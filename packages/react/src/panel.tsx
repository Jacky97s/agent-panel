import type { TurnContext } from '@agent-panel/core';
import { type ReactNode, useEffect, useState } from 'react';
import {
  configureAgentPanel,
  respond,
  runCapability,
  setDockOpen,
  useAgentState,
  useCapability,
} from './state.js';

export function AgentPanelRoot({
  baseUrl = '/__agent',
  children,
}: {
  baseUrl?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    configureAgentPanel(baseUrl);
  }, [baseUrl]);
  return <div className="ap-root">{children}</div>;
}

export function AgentDock({
  capabilityId,
  context,
}: {
  capabilityId: string;
  context?: TurnContext;
}) {
  const panel = useAgentState();
  return (
    <>
      <button
        type="button"
        className="ap-toggle"
        aria-pressed={panel.open}
        onClick={() => setDockOpen(!panel.open)}
      >
        Agent
      </button>
      {panel.open ? (
        <aside className="ap-dock" aria-label="Agent panel">
          <AgentPanel
            capabilityId={capabilityId}
            context={context}
            onClose={() => setDockOpen(false)}
          />
        </aside>
      ) : null}
    </>
  );
}

export function AgentPanel({
  capabilityId,
  context,
  onClose,
}: {
  capabilityId: string;
  context?: TurnContext;
  onClose?: () => void;
}) {
  const panel = useAgentState();
  const [draft, setDraft] = useState('');
  return (
    <section className="ap-panel">
      <header className="ap-header">
        <strong>Agent</strong>
        <button
          type="button"
          className="ap-text-button"
          onClick={onClose}
          aria-label="Close agent panel"
        >
          Close
        </button>
      </header>
      <div className="ap-transcript">
        {panel.items.length === 0 ? (
          <p className="ap-muted">Send a task for {capabilityId}.</p>
        ) : null}
        {panel.items.map((item) => {
          if (item.kind === 'user')
            return (
              <p key={item.id} className="ap-user">
                {item.text}
              </p>
            );
          if (item.kind === 'text') return <p key={item.id}>{item.text}</p>;
          if (item.kind === 'tool') {
            return (
              <p key={item.id} className="ap-tool">
                {item.title} <span>{item.status}</span>
              </p>
            );
          }
          if (item.kind === 'question') return <QuestionCard key={item.id} item={item} />;
          if (item.kind === 'permission') return <PermissionCard key={item.id} item={item} />;
          if (item.kind === 'result')
            return (
              <p key={item.id} className="ap-muted">
                {item.stopReason}
              </p>
            );
          return (
            <p key={item.id} className="ap-error">
              {item.message}
            </p>
          );
        })}
        {panel.error ? <p className="ap-error">{panel.error}</p> : null}
      </div>
      <form
        className="ap-composer"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft;
          setDraft('');
          void runCapability(capabilityId, text, context);
        }}
      >
        <textarea
          value={draft}
          aria-label="Message"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={panel.running || draft.trim().length === 0}>
          {panel.running ? 'Working' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function QuestionCard({
  item,
}: {
  item: Extract<ReturnType<typeof useAgentState>['items'][number], { kind: 'question' }>;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  if (item.done) return <p className="ap-card">Answered</p>;
  return (
    <form
      className="ap-card"
      onSubmit={(event) => {
        event.preventDefault();
        void respond(item.id, { kind: 'question', action: 'accept', content: selected });
      }}
    >
      <p>{item.message}</p>
      {item.fields.map((field) => (
        <fieldset key={field.name}>
          <legend>{field.label}</legend>
          {field.options ? (
            field.options.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={field.name}
                  checked={selected[field.name] === option.value}
                  onChange={() => setSelected((prev) => ({ ...prev, [field.name]: option.value }))}
                />
                {option.label}
              </label>
            ))
          ) : (
            <input
              value={selected[field.name] ?? ''}
              onChange={(event) =>
                setSelected((prev) => ({ ...prev, [field.name]: event.target.value }))
              }
            />
          )}
        </fieldset>
      ))}
      <button type="submit">Send answers</button>
    </form>
  );
}

function PermissionCard({
  item,
}: {
  item: Extract<ReturnType<typeof useAgentState>['items'][number], { kind: 'permission' }>;
}) {
  if (item.done) return <p className="ap-card">{item.title}</p>;
  return (
    <article className="ap-card">
      <p>{item.title}</p>
      <div className="ap-row">
        {item.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            onClick={() =>
              void respond(item.id, {
                kind: 'permission',
                optionId: option.optionId,
                cancel: option.kind.startsWith('reject'),
              })
            }
          >
            {option.name}
          </button>
        ))}
      </div>
    </article>
  );
}

export function AgentAction({
  capability,
  context,
  prompt,
  children,
}: {
  capability: string;
  context?: TurnContext;
  prompt?: string;
  children: ReactNode;
}) {
  const task = useCapability(capability);
  const text = prompt ?? (typeof children === 'string' ? children : '');
  return (
    <button
      type="button"
      disabled={task.running || text.length === 0}
      onClick={() => void task.run(text, context)}
    >
      {children}
    </button>
  );
}

export { useCapability };
