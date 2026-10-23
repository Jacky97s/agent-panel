import type { PanelEvent, PermissionChoice, QuestionField, TurnContext } from '@agent-panel/core';
import { useSyncExternalStore } from 'react';

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; title: string; name: string; status: string }
  | { kind: 'question'; id: string; message: string; fields: QuestionField[]; done: boolean }
  | {
      kind: 'permission';
      id: string;
      title: string;
      tool: string;
      options: PermissionChoice[];
      done: boolean;
    }
  | { kind: 'result'; id: string; stopReason: string }
  | { kind: 'error'; id: string; message: string };

type State = {
  baseUrl: string;
  open: boolean;
  sessionId: string | null;
  capabilityId: string | null;
  items: TranscriptItem[];
  running: boolean;
  error: string | null;
};

let state: State = {
  baseUrl: '/__agent',
  open: false,
  sessionId: null,
  capabilityId: null,
  items: [],
  running: false,
  error: null,
};
const listeners = new Set<() => void>();
let socket: WebSocket | null = null;

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useAgentState(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function configureAgentPanel(baseUrl: string) {
  if (state.baseUrl === baseUrl && socket) return;
  state = { ...state, baseUrl };
  socket?.close();
  const url = new URL(baseUrl, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  const next = new WebSocket(url);
  socket = next;
  next.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as Wire | { type: 'hello'; events: Wire[] };
    if (message.type === 'hello') {
      for (const item of message.events) apply(item);
      return;
    }
    apply(message);
  };
}

type Wire = PanelEvent & { sessionId: string };

function apply(event: Wire) {
  if (event.sessionId !== state.sessionId && event.type !== 'user') {
    if (!state.sessionId) state = { ...state, sessionId: event.sessionId };
    else if (event.sessionId !== state.sessionId) return;
  }
  const items = reduce(state.items, event);
  const running = event.type !== 'result' && event.type !== 'error';
  setState({ items, running, sessionId: event.sessionId });
}

function reduce(items: TranscriptItem[], event: PanelEvent): TranscriptItem[] {
  if (event.type === 'user')
    return [...items, { kind: 'user', id: `user-${items.length}`, text: event.text }];
  if (event.type === 'text') {
    const existing = items.find((item) => item.kind === 'text' && item.id === event.messageId);
    if (existing && existing.kind === 'text') {
      return items.map((item) =>
        item.kind === 'text' && item.id === event.messageId
          ? { ...item, text: item.text + event.text }
          : item,
      );
    }
    return [...items, { kind: 'text', id: event.messageId, text: event.text }];
  }
  if (event.type === 'tool') {
    const existing = items.find((item) => item.kind === 'tool' && item.id === event.id);
    if (existing) {
      return items.map((item) =>
        item.kind === 'tool' && item.id === event.id
          ? {
              ...item,
              title: event.title || item.title,
              name: event.name || item.name,
              status: event.status,
            }
          : item,
      );
    }
    return [
      ...items,
      { kind: 'tool', id: event.id, title: event.title, name: event.name, status: event.status },
    ];
  }
  if (event.type === 'question') {
    return [
      ...items,
      {
        kind: 'question',
        id: event.requestId,
        message: event.message,
        fields: event.fields,
        done: false,
      },
    ];
  }
  if (event.type === 'permission') {
    return [
      ...items,
      {
        kind: 'permission',
        id: event.requestId,
        title: event.title,
        tool: event.tool,
        options: event.options,
        done: false,
      },
    ];
  }
  if (event.type === 'result')
    return [
      ...items,
      { kind: 'result', id: `result-${items.length}`, stopReason: event.stopReason },
    ];
  return [...items, { kind: 'error', id: `error-${items.length}`, message: event.message }];
}

export function setDockOpen(open: boolean) {
  setState({ open });
}

let sending = false;

export async function runCapability(capabilityId: string, text: string, context?: TurnContext) {
  const trimmed = text.trim();
  if (!trimmed || state.running || sending) return;
  sending = true;
  setState({ open: true, capabilityId, running: true, error: null });
  try {
    const sessionId = await ensureSession(capabilityId);
    const response = await fetch(`${state.baseUrl}/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: trimmed, capabilityId, context }),
    });
    if (response.status === 409) {
      setState({ running: true });
      return;
    }
    if (!response.ok) throw new Error(await response.text());
  } catch (error) {
    setState({ running: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    sending = false;
  }
}

async function ensureSession(capabilityId: string): Promise<string> {
  if (state.sessionId && state.capabilityId === capabilityId) return state.sessionId;
  const response = await fetch(`${state.baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilityId }),
  });
  if (!response.ok) throw new Error(await response.text());
  const body = (await response.json()) as { id: string };
  setState({ sessionId: body.id, capabilityId, items: [] });
  return body.id;
}

export async function respond(requestId: string, answer: Record<string, unknown>) {
  if (!state.sessionId) return;
  setState({
    items: state.items.map((item) =>
      (item.kind === 'question' || item.kind === 'permission') && item.id === requestId
        ? { ...item, done: true }
        : item,
    ),
  });
  await fetch(`${state.baseUrl}/sessions/${state.sessionId}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, ...answer }),
  });
}

export function useCapability(capabilityId: string) {
  const snap = useAgentState();
  return {
    running: snap.running,
    run: (text: string, context?: TurnContext) => runCapability(capabilityId, text, context),
  };
}
