import { describe, expect, it } from 'vitest';
import { mapSessionUpdate } from './events.js';

describe('mapSessionUpdate', () => {
  it('maps agent text and tool updates and ignores plans', () => {
    expect(
      mapSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'Hello' },
      }),
    ).toEqual({ type: 'text', messageId: 'm1', text: 'Hello' });
    expect(
      mapSessionUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Write note.md',
        name: 'write',
        status: 'pending',
      }),
    ).toEqual({
      type: 'tool',
      id: 't1',
      name: 'write',
      title: 'Write note.md',
      status: 'pending',
    });
    expect(mapSessionUpdate({ sessionUpdate: 'plan' })).toBeNull();
  });
});
