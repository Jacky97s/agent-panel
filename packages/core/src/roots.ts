import path from 'node:path';

export function resolveRoots(cwd: string, roots: string[]): string[] {
  return [...new Set(roots.map((root) => path.resolve(cwd, root)))];
}

export function isInsideRoots(file: string, roots: string[]): boolean {
  const target = path.resolve(file);
  return roots.some((root) => {
    const base = path.resolve(root);
    const rel = path.relative(base, target);
    return (
      rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
    );
  });
}
