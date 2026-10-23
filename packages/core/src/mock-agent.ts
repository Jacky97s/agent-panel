import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  type AgentApp,
  type AgentContext,
  agent,
  methods,
  ndJsonStream,
} from '@agentclientprotocol/sdk';

export function createDemoAgent(): AgentApp {
  return agent({ name: 'agent-panel-demo' })
    .onRequest(methods.agent.initialize, async (ctx) => ({
      protocolVersion: ctx.params.protocolVersion,
      agentInfo: { name: 'agent-panel-demo', version: '0.1.0' },
    }))
    .onRequest(methods.agent.session.new, async () => ({
      sessionId: randomBytes(8).toString('hex'),
    }))
    .onNotification(methods.agent.session.cancel, async () => {})
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      const text = ctx.params.prompt
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      const sessionId = ctx.params.sessionId;
      await say(ctx, sessionId, 'Working on the capability.');
      const note = text.match(/note path: (\S+)/)?.[1];
      const file = text.match(/file path: (\S+)/)?.[1];
      const lower = text.toLowerCase();
      if (lower.includes('ask me') || lower.includes('clarify')) {
        const answer = await ctx.client.request(methods.client.elicitation.create, {
          mode: 'form',
          sessionId,
          message: 'Which tone?',
          requestedSchema: {
            type: 'object',
            required: ['tone'],
            properties: {
              tone: {
                type: 'string',
                title: 'Tone',
                oneOf: [
                  { const: 'Direct', title: 'Direct' },
                  { const: 'Warm', title: 'Warm' },
                ],
              },
            },
          },
        });
        const tone = readTone(answer);
        if (!tone || !note) return { stopReason: 'cancelled' as const };
        const wrote = await writeFile(ctx, sessionId, note, `# Note\n\nTone: ${tone}\n`);
        return { stopReason: wrote ? 'end_turn' : 'cancelled' };
      }
      const target = lower.includes('generate') ? file : note;
      if (!target) {
        await say(ctx, sessionId, 'No file path was provided.');
        return { stopReason: 'end_turn' as const };
      }
      const body = lower.includes('generate')
        ? 'Generated for the sandbox.\n'
        : `# Note\n\n${firstLine(text)}\n`;
      const wrote = await writeFile(ctx, sessionId, target, body);
      return { stopReason: wrote ? 'end_turn' : 'cancelled' };
    });
}

export function mockAgentPath(): string {
  return fileURLToPath(new URL('./mock-agent.js', import.meta.url));
}

async function say(ctx: { client: AgentContext }, sessionId: string, text: string) {
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });
}

async function writeFile(
  ctx: { client: AgentContext },
  sessionId: string,
  file: string,
  content: string,
): Promise<boolean> {
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: `write-${path.basename(file)}`,
      title: `Write ${path.basename(file)}`,
      name: 'write',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: file }],
    },
  });
  const permission = await ctx.client.request(methods.client.session.requestPermission, {
    sessionId,
    toolCall: {
      toolCallId: `write-${path.basename(file)}`,
      title: `Write ${path.basename(file)}`,
      name: 'write',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: file }],
    },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  });
  const outcome = permission.outcome;
  const allowed = outcome.outcome === 'selected' && outcome.optionId === 'allow';
  if (!allowed) return false;
  await ctx.client.request(methods.client.fs.writeTextFile, { sessionId, path: file, content });
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: `write-${path.basename(file)}`,
      status: 'completed',
    },
  });
  return true;
}

function readTone(answer: { action: string; content?: unknown }): string {
  if (answer.action !== 'accept' || !answer.content || typeof answer.content !== 'object')
    return '';
  const tone = (answer.content as { tone?: unknown }).tone;
  return typeof tone === 'string' ? tone : '';
}

function firstLine(text: string): string {
  const marker = '</agent-panel-capability>';
  const index = text.lastIndexOf(marker);
  const body = index >= 0 ? text.slice(index + marker.length) : text;
  return (
    body
      .split('\n')
      .map((entry) => entry.trim())
      .find(Boolean) || 'Updated note'
  );
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  const stream = ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );
  createDemoAgent().connect(stream);
}
