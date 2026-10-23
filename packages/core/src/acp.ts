import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  type ActiveSession,
  type AgentApp,
  type ClientApp,
  type ClientConnection,
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Stream,
} from '@agentclientprotocol/sdk';

export type { ActiveSession, AgentApp, Stream };

import {
  type Capability,
  type CapabilityResult,
  createCapabilityRegistry,
  type TurnContext,
} from './capability.js';
import { mapSessionUpdate, type PanelEvent, type QuestionField } from './events.js';
import { permissionDecision } from './policy.js';
import { composePrompt } from './prompt.js';
import { isInsideRoots, resolveRoots } from './roots.js';

export { createDemoAgent, mockAgentPath } from './mock-agent.js';

export const ACP_PRESETS = {
  'claude-code': { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
  codex: { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp'] },
  gemini: { command: 'gemini', args: ['--experimental-acp'] },
} as const;

export type AcpPreset = keyof typeof ACP_PRESETS;
export type AcpCommand = { command: string; args?: string[] };

export type UserAnswer =
  | { kind: 'permission'; optionId?: string; cancel?: boolean }
  | { kind: 'question'; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string> };

export type CapabilityClientOptions = {
  cwd: string;
  capabilities: Capability[];
  writableRoots?: string[];
  onEvent: (sessionId: string, event: PanelEvent) => void;
  ask: (sessionId: string, requestId: string) => Promise<UserAnswer>;
};

export type RunInput = {
  capability: Capability;
  text: string;
  context?: TurnContext;
};

export type CapabilityClient = {
  app: ClientApp;
  run(session: ActiveSession, input: RunInput): Promise<void>;
};

type SchemaProperty = {
  type?: string;
  title?: string | null;
  enum?: string[] | null;
  oneOf?: { const?: string; title?: string }[] | null;
};

export function createCapabilityClient(options: CapabilityClientOptions): CapabilityClient {
  const registry = createCapabilityRegistry(options.capabilities);
  const bound = new Map<string, string>();
  const rootsFor = (sessionId: string) => {
    const capability = registry.get(bound.get(sessionId) ?? '');
    return resolveRoots(options.cwd, [
      ...(options.writableRoots ?? []),
      ...(capability?.writableRoots ?? []),
    ]);
  };

  const app = client({ name: 'agent-panel' })
    .onRequest(methods.client.fs.readTextFile, async (ctx) => {
      if (!isInsideRoots(ctx.params.path, rootsFor(ctx.params.sessionId))) {
        throw new Error('path is outside writable roots');
      }
      const text = await fs.readFile(ctx.params.path, 'utf8');
      const rows = text.split('\n');
      const start = Math.max(0, (ctx.params.line ?? 1) - 1);
      const end = ctx.params.limit ? start + ctx.params.limit : undefined;
      return {
        content: ctx.params.line || ctx.params.limit ? rows.slice(start, end).join('\n') : text,
      };
    })
    .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
      if (!isInsideRoots(ctx.params.path, rootsFor(ctx.params.sessionId))) {
        throw new Error('path is outside writable roots');
      }
      await fs.mkdir(path.dirname(ctx.params.path), { recursive: true });
      await fs.writeFile(ctx.params.path, ctx.params.content);
      return {};
    })
    .onRequest(methods.client.session.requestPermission, async (ctx) => {
      const capability = registry.get(bound.get(ctx.params.sessionId) ?? '');
      const decision = permissionDecision(
        {
          name: ctx.params.toolCall.name,
          locations: ctx.params.toolCall.locations,
          options: ctx.params.options,
        },
        {
          allowedTools: capability?.allowedTools,
          roots: rootsFor(ctx.params.sessionId),
        },
      );
      if (decision !== 'ask') {
        return decision === 'cancel'
          ? { outcome: { outcome: 'cancelled' } }
          : { outcome: { outcome: 'selected', optionId: decision.optionId } };
      }
      const requestId = String(ctx.requestId);
      options.onEvent(ctx.params.sessionId, {
        type: 'permission',
        requestId,
        title: ctx.params.toolCall.title || ctx.params.toolCall.name || 'Permission',
        tool: ctx.params.toolCall.name || 'tool',
        options: ctx.params.options.map((option) => ({
          optionId: option.optionId,
          name: option.name,
          kind: option.kind,
        })),
      });
      const answer = await options.ask(ctx.params.sessionId, requestId);
      if (answer.kind !== 'permission' || answer.cancel || !answer.optionId) {
        return { outcome: { outcome: 'cancelled' } };
      }
      return { outcome: { outcome: 'selected', optionId: answer.optionId } };
    })
    .onRequest(methods.client.elicitation.create, async (ctx) => {
      const form = ctx.params as {
        mode?: string;
        sessionId?: string;
        message?: string;
        requestedSchema?: { properties?: { [key: string]: SchemaProperty } };
      };
      if (form.mode !== 'form' || !form.sessionId || !form.requestedSchema) {
        return { action: 'decline' };
      }
      const requestId = String(ctx.requestId);
      options.onEvent(form.sessionId, {
        type: 'question',
        requestId,
        message: form.message || 'Question',
        fields: fieldsFromSchema(form.requestedSchema),
      });
      const answer = await options.ask(form.sessionId, requestId);
      if (answer.kind !== 'question' || answer.action !== 'accept') {
        return { action: answer.kind === 'question' ? answer.action : 'cancel' };
      }
      return { action: 'accept', content: answer.content ?? {} };
    });

  return {
    app,
    async run(session, input) {
      bound.set(session.sessionId, input.capability.id);
      const prompt = await composePrompt(input.capability, input.text, input.context);
      options.onEvent(session.sessionId, { type: 'user', text: input.text });
      const pending = session.prompt(prompt);
      try {
        while (true) {
          const message = await session.nextUpdate();
          if (message.kind === 'stop') break;
          const event = mapSessionUpdate(message.update);
          if (event) options.onEvent(session.sessionId, event);
        }
        const response = await pending;
        const result: CapabilityResult = {
          capabilityId: input.capability.id,
          sessionId: session.sessionId,
          stopReason: response.stopReason,
        };
        options.onEvent(session.sessionId, { type: 'result', stopReason: response.stopReason });
        await input.capability.onComplete?.(result);
      } catch (error) {
        options.onEvent(session.sessionId, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        bound.delete(session.sessionId);
      }
    },
  };
}

export async function connectAcp(
  app: ClientApp,
  target: Stream | AgentApp,
): Promise<ClientConnection> {
  const connection = 'connect' in target ? app.connect(target) : app.connect(target);
  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: 'agent-panel', version: '0.1.0' },
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      elicitation: { form: {} },
    },
  });
  return connection;
}

export function openSession(connection: ClientConnection, cwd: string): Promise<ActiveSession> {
  return connection.agent.buildSession(cwd).start();
}

export function cancelSession(connection: ClientConnection, sessionId: string): Promise<void> {
  return connection.agent.notify(methods.agent.session.cancel, { sessionId });
}

export function spawnAcpAgent(spec: AcpCommand, cwd: string): { stream: Stream; stop: () => void } {
  const child = spawn(spec.command, spec.args ?? [], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  if (!child.stdin || !child.stdout) throw new Error(`failed to spawn ${spec.command}`);
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  return {
    stream,
    stop: () => {
      child.kill();
    },
  };
}

function fieldsFromSchema(schema: {
  properties?: { [key: string]: SchemaProperty };
}): QuestionField[] {
  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const options =
      property.oneOf
        ?.filter((option) => option.const)
        .map((option) => ({
          value: option.const as string,
          label: option.title || option.const || '',
        })) ?? property.enum?.map((value) => ({ value, label: value }));
    return { name, label: property.title || name, options };
  });
}
