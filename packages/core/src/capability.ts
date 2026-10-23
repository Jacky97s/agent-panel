export type TurnContext = {
  selection?: string;
  file?: string;
  element?: unknown;
  state?: unknown;
  [key: string]: unknown;
};

export type CapabilityResult = {
  capabilityId: string;
  sessionId: string;
  stopReason: string;
};

export type Capability = {
  id: string;
  label?: string;
  systemPromptAppend?: string;
  writableRoots?: string[];
  allowedTools?: string[];
  buildContext?: (ctx: TurnContext) => string[] | Promise<string[]>;
  onComplete?: (result: CapabilityResult) => void | Promise<void>;
};

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function assertCapabilityId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`invalid capability id: ${id}`);
  return id;
}

export type CapabilityRegistry = {
  get(id: string): Capability | undefined;
  list(): Capability[];
};

export function createCapabilityRegistry(capabilities: Capability[]): CapabilityRegistry {
  const byId = new Map<string, Capability>();
  for (const capability of capabilities) {
    const id = assertCapabilityId(capability.id);
    if (byId.has(id)) throw new Error(`duplicate capability: ${id}`);
    byId.set(id, capability);
  }
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
  };
}

export async function contextLines(
  capability: Capability,
  ctx: TurnContext | undefined,
): Promise<string[]> {
  const built = capability.buildContext ? await capability.buildContext(ctx ?? {}) : [];
  const lines = [...built];
  if (ctx?.file) lines.push(`Current file: ${ctx.file}`);
  if (ctx?.selection) lines.push(`Selection: ${ctx.selection}`);
  if (ctx?.element !== undefined) lines.push(`Selected element: ${JSON.stringify(ctx.element)}`);
  return lines;
}
