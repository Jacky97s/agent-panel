import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Capability } from '@agent-panel/core';
import { createDemoAgent } from '@agent-panel/core/acp';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createAgentServer } from './server.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('agent server', () => {
  it('streams a permission and writes the note after the browser allows it', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agent-panel-server-'));
    dirs.push(cwd);
    const note = path.join(cwd, 'sandbox', 'note.md');
    const capability: Capability = {
      id: 'note',
      label: 'Note',
      writableRoots: [path.join(cwd, 'sandbox')],
      allowedTools: ['write'],
      buildContext: () => [`note path: ${note}`],
    };
    const agent = createAgentServer({
      cwd,
      capabilities: [capability],
      agent: { app: createDemoAgent() },
    });
    const http = createServer((req, res) => {
      void agent.handle(req, res);
    });
    agent.attach(http);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/__agent`;
    try {
      const capabilities = (await fetch(`${base}/capabilities`).then((res) => res.json())) as {
        capabilities: { id: string }[];
      };
      expect(capabilities.capabilities.map((item) => item.id)).toEqual(['note']);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/__agent/ws`);
      const events: { type: string; requestId?: string; optionId?: string; stopReason?: string }[] =
        [];
      await new Promise<void>((resolve) => socket.once('open', resolve));
      socket.on('message', (data) => {
        const message = JSON.parse(String(data)) as { type: string; events?: unknown[] };
        if (message.type === 'hello') return;
        events.push(message as { type: string; requestId?: string });
      });
      const created = (await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityId: 'note' }),
      }).then((res) => res.json())) as { id: string };
      const posted = await fetch(`${base}/sessions/${created.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Tighten the note and keep it short.' }),
      });
      expect(posted.status).toBe(202);
      const permission = await waitFor(events, (event) => event.type === 'permission');
      const allowed = await fetch(`${base}/sessions/${created.id}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: permission.requestId,
          kind: 'permission',
          optionId: 'allow',
        }),
      });
      expect(allowed.status).toBe(200);
      await waitFor(events, (event) => event.type === 'result');
      expect(await readFile(note, 'utf8')).toContain('# Note');
      socket.close();
    } finally {
      await agent.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});

async function waitFor<T extends { type: string }>(
  events: T[],
  match: (event: T) => boolean,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    const found = events.find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for ${events.map((event) => event.type).join(',')}`);
}
