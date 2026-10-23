export type QuestionField = {
  name: string;
  label: string;
  options?: { value: string; label: string }[];
};

export type PermissionChoice = {
  optionId: string;
  name: string;
  kind: string;
};

export type PanelEvent =
  | { type: 'user'; text: string }
  | { type: 'text'; messageId: string; text: string }
  | { type: 'tool'; id: string; name: string; title: string; status: string }
  | { type: 'question'; requestId: string; message: string; fields: QuestionField[] }
  | {
      type: 'permission';
      requestId: string;
      title: string;
      tool: string;
      options: PermissionChoice[];
    }
  | { type: 'result'; stopReason: string }
  | { type: 'error'; message: string };

type ChunkUpdate = {
  sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk';
  messageId?: string | null;
  content?: { type?: string; text?: string };
};

type ToolUpdate = {
  sessionUpdate: 'tool_call' | 'tool_call_update';
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  status?: string | null;
};

export function mapSessionUpdate(update: { sessionUpdate: string }): PanelEvent | null {
  if (
    update.sessionUpdate === 'agent_message_chunk' ||
    update.sessionUpdate === 'agent_thought_chunk'
  ) {
    const chunk = update as ChunkUpdate;
    if (chunk.content?.type !== 'text' || !chunk.content.text) return null;
    return {
      type: 'text',
      messageId: chunk.messageId || chunk.sessionUpdate,
      text: chunk.content.text,
    };
  }
  if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
    const tool = update as ToolUpdate;
    return {
      type: 'tool',
      id: tool.toolCallId,
      name: tool.name || '',
      title: tool.title || '',
      status: tool.status || (update.sessionUpdate === 'tool_call' ? 'pending' : 'in_progress'),
    };
  }
  return null;
}
