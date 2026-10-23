#!/usr/bin/env node
import { statSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_NAMES = [
  'integrate-agent-panel',
  'create-capability',
  'connect-acp-agent',
  'troubleshoot-agent-panel',
] as const;

export function findSkillsDir(from = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    path.resolve(from, '../skills'),
    path.resolve(from, '../../skills'),
    path.resolve(from, '../../../skills'),
  ];
  for (const candidate of candidates) {
    if (exists(path.join(candidate, 'integrate-agent-panel', 'SKILL.md'))) return candidate;
  }
  throw new Error('Could not find the agent-panel skills directory.');
}

function exists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export async function addSkills(
  target = process.cwd(),
  source = findSkillsDir(),
): Promise<string[]> {
  const destRoot = path.resolve(target, 'skills');
  await mkdir(destRoot, { recursive: true });
  const names = (await readdir(source, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && SKILL_NAMES.includes(entry.name as (typeof SKILL_NAMES)[number]),
    )
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const dest = path.join(destRoot, name);
    await rm(dest, { recursive: true, force: true });
    await cp(path.join(source, name), dest, { recursive: true });
  }
  return names;
}

async function main() {
  const [command = 'add-skills', target = process.cwd()] = process.argv.slice(2);
  if (command !== 'add-skills' && command !== 'init') {
    process.stderr.write('Usage: agent-panel add-skills [dir]\n       agent-panel init [dir]\n');
    process.exitCode = 1;
    return;
  }
  const names = await addSkills(target);
  process.stdout.write(`Installed ${names.join(', ')} into ${path.resolve(target, 'skills')}\n`);
  if (command === 'init') {
    process.stdout.write(
      'Next: mount @agent-panel/server, render @agent-panel/react, and register a capability. See skills/integrate-agent-panel/SKILL.md.\n',
    );
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  void main();
}
