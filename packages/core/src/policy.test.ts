import { describe, expect, it } from 'vitest';
import { permissionDecision } from './policy.js';

const options = [
  { optionId: 'allow', kind: 'allow_once' },
  { optionId: 'reject', kind: 'reject_once' },
];

describe('permissionDecision', () => {
  it('asks when the tool is allowed and every path is inside the roots', () => {
    expect(
      permissionDecision(
        { name: 'write', locations: [{ path: '/work/sandbox/note.md' }], options },
        { allowedTools: ['write'], roots: ['/work/sandbox'] },
      ),
    ).toBe('ask');
  });

  it('rejects a tool that the capability did not allow', () => {
    expect(
      permissionDecision(
        { name: 'bash', locations: [], options },
        { allowedTools: ['write'], roots: ['/work/sandbox'] },
      ),
    ).toEqual({ optionId: 'reject' });
  });

  it('rejects a write outside the writable roots', () => {
    expect(
      permissionDecision(
        { name: 'write', locations: [{ path: '/work/sandbox-backup/note.md' }], options },
        { allowedTools: ['write'], roots: ['/work/sandbox'] },
      ),
    ).toEqual({ optionId: 'reject' });
  });
});
