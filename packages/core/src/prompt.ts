import { type Capability, contextLines, type TurnContext } from './capability.js';

export async function composePrompt(
  capability: Capability,
  text: string,
  ctx?: TurnContext,
): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error('empty prompt');
  const lines = [capability.systemPromptAppend, ...(await contextLines(capability, ctx))].filter(
    (line): line is string => Boolean(line),
  );
  if (lines.length === 0) return body;
  return `<agent-panel-capability>\n${lines.join('\n')}\n</agent-panel-capability>\n\n${body}`;
}
