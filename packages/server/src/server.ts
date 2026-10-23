import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import type { Capability, PanelEvent, TurnContext } from '@agent-panel/core';
import {
  type AcpCommand,
  type ActiveSession,
  type AgentApp,
  cancelSession,
  connectAcp,
  createCapabilityClient,
  openSession,
  spawnAcpAgent,
  type UserAnswer,
} from '@agent-panel/core/acp';
import { WebSocketServer } from 'ws';

export type AgentTarget = AcpCommand | { app: AgentApp };

export type AgentServerOptions = {
  cwd: string;
  capabilities?: Capability[];
  writableRoots?: string[];
  agent: AgentTarget;
  prefix?: string;
  loopbackOnly?: boolean;
};

export type AgentServer = {
  prefix: string;
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  middleware(): (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
  attach(server: HttpServer): void;
  close(): Promise<void>;
};

type WireEvent = PanelEvent & { sessionId: string };
type Waiter = (answer: UserAnswer) => void;
type LiveSession = { session: ActiveSession; capabilityId: string };

const BODY_LIMIT = 1024 * 1024;

export function createAgentServer(options: AgentServerOptions): AgentServer {
  const prefix = normalizePrefix(options.prefix);
  const loopbackOnly = options.loopbackOnly !== false;
  const capabilities = options.capabilities ?? [];
  const sessions = new Map<string, LiveSession>();
  const waiters = new Map<string, Waiter>();
  const running = new Set<string>();
  const buffer: WireEvent[] = [];
  const sockets = new Set<{
    readyState: number;
    send: (data: string) => void;
    close: () => void;
  }>();
  let connection: Awaited<ReturnType<typeof connectAcp>> | null = null;
  let connecting: Promise<void> | null = null;
  let stopAgent = () => {};

  const host = createCapabilityClient({
    cwd: options.cwd,
    capabilities,
    writableRoots: options.writableRoots,
    onEvent: (sessionId, event) => emit({ ...event, sessionId }),
    ask: (_sessionId, requestId) =>
      new Promise((resolve) => {
        waiters.set(requestId, resolve);
      }),
  });

  function emit(event: WireEvent) {
    buffer.push(event);
    if (buffer.length > 200) buffer.shift();
    const data = JSON.stringify(event);
    for (const socket of sockets) {
      if (socket.readyState === 1) socket.send(data);
    }
  }

  async function ensureConnection() {
    if (connection) return connection;
    if (!connecting) {
      connecting = (async () => {
        if ('app' in options.agent) {
          connection = await connectAcp(host.app, options.agent.app);
          return;
        }
        const spawned = spawnAcpAgent(options.agent, options.cwd);
        stopAgent = spawned.stop;
        connection = await connectAcp(host.app, spawned.stream);
      })().finally(() => {
        connecting = null;
      });
    }
    await connecting;
    if (!connection) throw new Error('ACP agent did not connect');
    return connection;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith(prefix)) return false;
    const rest = url.pathname.slice(prefix.length) || '/';
    const method = req.method ?? 'GET';
    if (loopbackOnly && !isLoopback(req)) return json(res, 403, { error: 'loopback only' });
    try {
      if (method === 'GET' && rest === '/status') {
        return json(res, 200, {
          connected: connection !== null,
          command: 'app' in options.agent ? 'in-process' : options.agent.command,
        });
      }
      if (method === 'GET' && rest === '/capabilities') {
        return json(res, 200, {
          capabilities: capabilities.map((capability) => ({
            id: capability.id,
            label: capability.label ?? capability.id,
            tools: capability.allowedTools ?? [],
          })),
        });
      }
      if (method === 'GET' && rest === '/sessions') {
        return json(res, 200, {
          sessions: [...sessions.entries()].map(([id, session]) => ({
            id,
            capabilityId: session.capabilityId,
          })),
        });
      }
      if (method === 'POST' && rest === '/sessions') {
        const body = await readJson(req);
        const capabilityId = typeof body.capabilityId === 'string' ? body.capabilityId : '';
        const capability = capabilities.find((item) => item.id === capabilityId);
        if (!capability) return json(res, 400, { error: 'unknown capability' });
        const acp = await ensureConnection();
        const session = await openSession(acp, options.cwd);
        sessions.set(session.sessionId, { session, capabilityId: capability.id });
        return json(res, 200, { id: session.sessionId, capabilityId: capability.id });
      }
      const match = /^\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(rest);
      if (!match) return json(res, 404, { error: 'not found' });
      const id = decodeURIComponent(match[1] ?? '');
      const action = match[2];
      const live = sessions.get(id);
      if (!live) return json(res, 404, { error: 'session not found' });
      if (method === 'POST' && action === 'messages') {
        const body = await readJson(req);
        if (typeof body.text !== 'string' || !body.text.trim()) {
          return json(res, 400, { error: 'missing text' });
        }
        if (running.has(id)) return json(res, 409, { error: 'session is already running' });
        const capabilityId =
          typeof body.capabilityId === 'string' ? body.capabilityId : live.capabilityId;
        const capability = capabilities.find((item) => item.id === capabilityId);
        if (!capability) return json(res, 400, { error: 'unknown capability' });
        live.capabilityId = capability.id;
        running.add(id);
        void host
          .run(live.session, { capability, text: body.text, context: parseContext(body.context) })
          .catch((error: unknown) => {
            emit({
              type: 'error',
              sessionId: id,
              message: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => running.delete(id));
        return json(res, 202, { ok: true });
      }
      if (method === 'POST' && action === 'respond') {
        const body = await readJson(req);
        const requestId = typeof body.requestId === 'string' ? body.requestId : '';
        const waiter = waiters.get(requestId);
        const answer = parseAnswer(body);
        if (!waiter || !answer)
          return json(res, waiter ? 400 : 409, {
            error: waiter ? 'invalid response' : 'nothing pending',
          });
        waiters.delete(requestId);
        waiter(answer);
        return json(res, 200, { ok: true });
      }
      if (method === 'POST' && action === 'cancel') {
        for (const [requestId, waiter] of waiters) {
          waiter({ kind: 'permission', cancel: true });
          waiters.delete(requestId);
        }
        if (connection) await cancelSession(connection, id);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, message === 'body too large' || message === 'invalid json' ? 400 : 500, {
        error: message,
      });
    }
  }

  function middleware() {
    return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
      void handle(req, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch((error: unknown) => {
          if (!res.headersSent) {
            json(res, 500, { error: error instanceof Error ? error.message : String(error) });
            return;
          }
          next(error);
        });
    };
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'hello', events: buffer }));
    socket.on('close', () => sockets.delete(socket));
  });

  function attach(server: HttpServer) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname !== `${prefix}/ws`) return;
      if (loopbackOnly && !isLoopback(req)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  }

  async function close() {
    for (const waiter of waiters.values()) waiter({ kind: 'permission', cancel: true });
    waiters.clear();
    for (const socket of sockets) socket.close();
    connection?.close();
    stopAgent();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  return { prefix, handle, middleware, attach, close };
}

function parseAnswer(body: Record<string, unknown>): UserAnswer | null {
  if (body.kind === 'permission') {
    return {
      kind: 'permission',
      optionId: typeof body.optionId === 'string' ? body.optionId : undefined,
      cancel: body.cancel === true,
    };
  }
  if (
    body.kind === 'question' &&
    (body.action === 'accept' || body.action === 'decline' || body.action === 'cancel')
  ) {
    const content: Record<string, string> = {};
    if (body.content && typeof body.content === 'object') {
      for (const [key, value] of Object.entries(body.content)) {
        if (typeof value === 'string') content[key] = value;
      }
    }
    return { kind: 'question', action: body.action, content };
  }
  return null;
}

function parseContext(value: unknown): TurnContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context: TurnContext = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    if (typeof entry === 'string') context[key] = entry.slice(0, 4000);
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null)
      context[key] = entry;
  }
  return context;
}

function normalizePrefix(prefix = '/__agent'): string {
  const value = prefix.startsWith('/') ? prefix : `/${prefix}`;
  return value.replace(/\/$/, '') || '/__agent';
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function json(res: ServerResponse, status: number, body: unknown): boolean {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject(new Error('invalid json'));
          return;
        }
        resolve(value as Record<string, unknown>);
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}
