import { isInsideRoots } from './roots.js';

export type PermissionProbe = {
  name?: string | null;
  locations?: { path: string }[] | null;
  options: { optionId: string; kind: string }[];
};

export function permissionDecision(
  probe: PermissionProbe,
  rules: { allowedTools?: string[]; roots: string[] },
): 'ask' | { optionId: string } | 'cancel' {
  const named = probe.name ?? undefined;
  const blockedTool = Boolean(rules.allowedTools && named && !rules.allowedTools.includes(named));
  const outside = (probe.locations ?? []).some(
    (location) => !isInsideRoots(location.path, rules.roots),
  );
  if (!blockedTool && !outside) return 'ask';
  const reject = probe.options.find(
    (option) => option.kind === 'reject_once' || option.kind === 'reject_always',
  );
  return reject ? { optionId: reject.optionId } : 'cancel';
}
