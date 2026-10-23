import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectAcp, createCapabilityClient, openSession } from './acp.js';
import type { Capability } from './capability.js';
import type { PanelEvent } from './events.js';
import { createDemoAgent } from './mock-agent.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ACP capability turn', () => {
  it('asks for permission, writes inside the root, and reports completion', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agent-panel-acp-'));
    dirs.push(cwd);
    const note = path.join(cwd, 'sandbox', 'note.md');
    const events: PanelEvent[] = [];
    let completed = '';
    const capability: Capability = {
      id: 'note',
      label: 'Note',
      systemPromptAppend: 'Edit the note.',
      writableRoots: [path.join(cwd, 'sandbox')],
      allowedTools: ['write'],
      buildContext: () => [`note path: ${note}`],
      onComplete: (result) => {
        completed = result.stopReason;
      },
    };
    const host = createCapabilityClient({
      cwd,
      capabilities: [capability],
      onEvent: (_sessionId, event) => events.push(event),
      ask: async () => ({ kind: 'permission', optionId: 'allow' }),
    });
    const connection = await connectAcp(host.app, createDemoAgent());
    const session = await openSession(connection, cwd);
    await host.run(session, { capability, text: 'Tighten the note and keep it short.' });
    expect(await readFile(note, 'utf8')).toContain('# Note');
    expect(events.some((event) => event.type === 'permission')).toBe(true);
    expect(events.some((event) => event.type === 'tool' && event.status === 'completed')).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({ type: 'result', stopReason: 'end_turn' });
    expect(completed).toBe('end_turn');
    connection.close();
  });

  it('answers an elicitation and refuses a path outside the writable root', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'agent-panel-acp-'));
    dirs.push(cwd);
    const outside = path.join(cwd, 'outside.md');
    const asked: string[] = [];
    const capability: Capability = {
      id: 'note',
      writableRoots: [path.join(cwd, 'sandbox')],
      allowedTools: ['write'],
      buildContext: () => [`note path: ${outside}`],
    };
    const host = createCapabilityClient({
      cwd,
      capabilities: [capability],
      onEvent: () => {},
      ask: async (_sessionId, requestId) => {
        asked.push(requestId);
        return { kind: 'question', action: 'accept', content: { tone: 'Direct' } };
      },
    });
    const connection = await connectAcp(host.app, createDemoAgent());
    const session = await openSession(connection, cwd);
    await host.run(session, { capability, text: 'Ask me which tone to use before you edit.' });
    expect(asked).toHaveLength(1);
    await expect(readFile(outside, 'utf8')).rejects.toThrow();
    connection.close();
  });
});
