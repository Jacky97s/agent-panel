import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInsideRoots, resolveRoots } from './roots.js';

describe('writable roots', () => {
  it('accepts a file inside a root and rejects a lookalike prefix', () => {
    const root = path.resolve('/workspace/sandbox');
    expect(isInsideRoots(path.join(root, 'note.md'), [root])).toBe(true);
    expect(isInsideRoots(path.resolve('/workspace/sandbox-backup/note.md'), [root])).toBe(false);
    expect(isInsideRoots(path.resolve('/etc/passwd'), [root])).toBe(false);
  });

  it('resolves relative roots from the working directory', () => {
    expect(resolveRoots('/app', ['sandbox', '/abs'])).toEqual([
      path.resolve('/app/sandbox'),
      path.resolve('/abs'),
    ]);
  });
});
