import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addSkills, findSkillsDir } from './cli.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('addSkills', () => {
  it('copies the repo skills into skills/ and replaces them on a second run', async () => {
    const target = await mkdtemp(path.join(tmpdir(), 'agent-panel-skills-'));
    dirs.push(target);
    const source = findSkillsDir();
    const first = await addSkills(target, source);
    expect(first).toEqual([
      'connect-acp-agent',
      'create-capability',
      'integrate-agent-panel',
      'troubleshoot-agent-panel',
    ]);
    const skill = path.join(target, 'skills', 'create-capability', 'SKILL.md');
    const text = await readFile(skill, 'utf8');
    expect(text.startsWith('---\nname: create-capability\n')).toBe(true);
    expect(text).toContain('description:');
    await addSkills(target, source);
    expect(await readFile(skill, 'utf8')).toBe(text);
  });
});
