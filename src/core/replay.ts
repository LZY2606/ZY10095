/**
 * Replay engine.
 *
 * Rebuilds, for every recorded keyboard step, the deterministic view the
 * comparison rules operate on: flattened DOM, the keyboard tab order, the
 * assistive-technology reachable set, live-region state, focus transitions,
 * popup state and announcements.
 */

import type {
  Announcement,
  BuildInput,
  FlatA11yNode,
  FlatDomNode,
  FocusEvent,
  ReplayStep,
  ReplayedBuild,
  StepInput,
} from './types.js';
import { compareStrings, hashString } from './deterministic.js';
import { flattenDom, normalizeStates } from './dom-tree.js';

const POPUP_ROLES = new Set([
  'dialog',
  'alertdialog',
  'menu',
  'listbox',
  'grid',
  'tree',
  'tooltip',
]);

/**
 * Tags that produce no accessibility-tree node by themselves. A div/span/body
 * is still in the flattened DOM for ancestor context, but it is exposed to
 * assistive technology only with an explicit role, focusability or live-ness.
 */
const GENERIC_TAGS = new Set([
  'body',
  'div',
  'span',
  'p',
  'label',
  'form',
  'section',
  'header',
  'footer',
  'article',
  'blockquote',
  'dd',
  'dl',
  'hr',
]);

export interface ReplayError extends Error {
  code:
    | 'EMPTY_STEPS'
    | 'DENSE_STEPS'
    | 'SIDE_MISMATCH'
    | 'DANGLING_REF'
    | 'ACTION_MISMATCH';
}

export function replayError(
  code: ReplayError['code'],
  message: string,
): ReplayError {
  const error = new Error(message) as ReplayError;
  error.code = code;
  return error;
}

export function replayBuild(build: BuildInput): ReplayedBuild {
  if (build.steps.length === 0) {
    throw replayError('EMPTY_STEPS', `${build.side}: at least one step is required`);
  }
  const sorted = [...build.steps].sort((a, b) => a.index - b.index);
  const steps = sorted.map((step) => replayStep(step, build));
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.index !== i) {
      throw replayError(
        'DENSE_STEPS',
        `${build.side}: step indices must be dense starting at 0`,
      );
    }
  }
  deriveLiveAnnouncements(steps);
  return {
    side: build.side,
    fingerprint: build.fingerprint,
    label: build.label ?? build.side,
    steps,
  };
}

/** Throws when the two builds do not apply the same keyboard sequence. */
export function assertSameActionSequence(
  baseline: ReplayedBuild,
  candidate: ReplayedBuild,
): void {
  if (baseline.steps.length !== candidate.steps.length) {
    throw replayError(
      'ACTION_MISMATCH',
      `step count differs: ${baseline.steps.length} vs ${candidate.steps.length}`,
    );
  }
  for (let i = 0; i < baseline.steps.length; i++) {
    const a = canonicalAction(baseline.steps[i]!.action);
    const b = canonicalAction(candidate.steps[i]!.action);
    if (a !== b) {
      throw replayError(
        'ACTION_MISMATCH',
        `action at step ${i} differs: ${a} vs ${b}`,
      );
    }
  }
}

function canonicalAction(action: Record<string, string | number | boolean>): string {
  const keys = Object.keys(action).sort(compareStrings);
  return keys.map((key) => `${key}=${String(action[key])}`).join('&');
}

function replayStep(step: StepInput, build: BuildInput): ReplayStep {
  const nodes = flattenDom(step.dom);
  const byKey: Record<string, FlatDomNode> = {};
  for (const node of nodes) {
    byKey[node.key] = node;
  }

  const a11y = buildA11yNodes(step, nodes, byKey);
  const a11yByKey: Record<string, FlatA11yNode> = {};
  for (const node of a11y) {
    a11yByKey[node.domKey] = node;
  }

  return {
    index: step.index,
    action: step.action,
    nodes,
    byKey,
    a11y,
    a11yByKey,
    tabOrder: computeTabOrder(nodes, byKey),
    a11yReachable: computeA11yReachable(nodes, byKey, a11yByKey),
    liveRegions: collectLiveRegions(nodes, byKey),
    focus: resolveFocus(step, byKey),
    announcements: resolveImportedAnnouncements(step, byKey),
    openPopups: collectOpenPopups(nodes, byKey, a11yByKey),
    fingerprint: build.fingerprint,
  };
}

function buildA11yNodes(
  step: StepInput,
  nodes: FlatDomNode[],
  byKey: Record<string, FlatDomNode>,
): FlatA11yNode[] {
  const resolveDomKey = (ref: string): string | null => {
    if (byKey[ref]) {
      return ref;
    }
    const byId = nodes.find((node) => node.id === ref);
    return byId ? byId.key : null;
  };

  const out: FlatA11yNode[] = [];
  const claimedDomKeys = new Set<string>();
  for (const entry of step.a11y ?? []) {
    const domKey = resolveDomKey(entry.domRef);
    if (!domKey) {
      throw replayError(
        'DANGLING_REF',
        `step ${step.index}: a11y node references unknown domRef ${entry.domRef}`,
      );
    }
    claimedDomKeys.add(domKey);
    const domNode = byKey[domKey]!;
    out.push({
      domKey,
      role: entry.role,
      name: (entry.name ?? domNode.name).trim(),
      states: normalizeStates(entry.states ?? domNode.states),
      focusable: entry.focusable ?? domNode.focusable,
      ignored: entry.ignored ?? false,
    });
  }

  for (const node of nodes) {
    if (claimedDomKeys.has(node.key)) {
      continue;
    }
    out.push({
      domKey: node.key,
      role: node.role,
      name: node.name,
      states: node.states,
      focusable: node.focusable,
      ignored: false,
    });
  }

  out.sort((a, b) => compareStrings(a.domKey, b.domKey));
  return out;
}

export function hasHiddenAncestor(
  node: FlatDomNode,
  byKey: Record<string, FlatDomNode>,
): boolean {
  let current: FlatDomNode | undefined = node;
  while (current) {
    if (current.hidden || current.ariaHidden) {
      return true;
    }
    current = current.parentKey ? byKey[current.parentKey] ?? undefined : undefined;
  }
  return false;
}

function computeTabOrder(
  nodes: FlatDomNode[],
  byKey: Record<string, FlatDomNode>,
): string[] {
  const reachable = nodes.filter(
    (node) => node.focusable && !node.disabled && !hasHiddenAncestor(node, byKey),
  );
  const withIndex = reachable.map((node) => ({
    key: node.key,
    tabIndex: node.tabindex ?? 0,
    preorder: node.preorder,
  }));
  const positive = withIndex
    .filter((entry) => entry.tabIndex > 0)
    .sort((a, b) =>
      a.tabIndex === b.tabIndex ? a.preorder - b.preorder : a.tabIndex - b.tabIndex,
    );
  const zero = withIndex
    .filter((entry) => entry.tabIndex === 0)
    .sort((a, b) => a.preorder - b.preorder);
  return [...positive, ...zero].map((entry) => entry.key);
}

function computeA11yReachable(
  nodes: FlatDomNode[],
  byKey: Record<string, FlatDomNode>,
  a11yByKey: Record<string, FlatA11yNode>,
): string[] {
  const out = nodes
    .filter((node) => {
      if (hasHiddenAncestor(node, byKey)) {
        return false;
      }
      const a11y = a11yByKey[node.key];
      if (a11y?.ignored) {
        return false;
      }
      if (node.role === 'presentation' || node.role === 'none') {
        return false;
      }
      if (node.focusable || (node.live && node.live !== 'off')) {
        return true;
      }
      // An explicit/implicit ARIA role distinct from the generic tag name is
      // exposed; bare containers are not.
      return !(GENERIC_TAGS.has(node.tag) && node.role === node.tag);
    })
    .map((node) => node.key);
  out.sort(compareStrings);
  return out;
}

export function subtreeTextOfFlat(
  node: FlatDomNode,
  byKey: Record<string, FlatDomNode>,
): string {
  const descendants = Object.values(byKey)
    .filter((candidate) => isDescendant(candidate, node, byKey))
    .sort((a, b) => a.preorder - b.preorder);
  return [node, ...descendants]
    .map((entry) => entry.text)
    .filter((text) => text.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDescendant(
  candidate: FlatDomNode,
  ancestor: FlatDomNode,
  byKey: Record<string, FlatDomNode>,
): boolean {
  let parentKey = candidate.parentKey;
  while (parentKey) {
    if (parentKey === ancestor.key) {
      return true;
    }
 parentKey = byKey[parentKey]?.parentKey ?? null;
  }
  return false;
}

function collectLiveRegions(
  nodes: FlatDomNode[],
  byKey: Record<string, FlatDomNode>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const node of nodes) {
    if (node.live && node.live !== 'off' && !hasHiddenAncestor(node, byKey)) {
      out[node.key] = subtreeTextOfFlat(node, byKey);
    }
  }
  return out;
}

function collectOpenPopups(
  nodes: FlatDomNode[],
  byKey: Record<string, FlatDomNode>,
  a11yByKey: Record<string, FlatA11yNode>,
): string[] {
  return nodes
    .filter((node) => {
      const role = a11yByKey[node.key]?.role ?? node.role;
      return POPUP_ROLES.has(role) && !hasHiddenAncestor(node, byKey);
    })
    .map((node) => node.key)
    .sort(compareStrings);
}

function resolveFocus(
  step: StepInput,
  byKey: Record<string, FlatDomNode>,
): FocusEvent | null {
  if (!step.focus) {
    return null;
  }
  const resolveRef = (ref: string | undefined): string | null => {
    if (!ref) {
      return null;
    }
    if (byKey[ref]) {
      return ref;
    }
    const byId = Object.values(byKey).find((node) => node.id === ref);
    if (byId) {
      return byId.key;
    }
    throw replayError(
      'DANGLING_REF',
      `step ${step.index}: focus event references unknown node ${ref}`,
    );
  };
  return {
    fromKey: resolveRef(step.focus.fromRef),
    toKey: resolveRef(step.focus.toRef),
    reason: step.focus.reason ?? 'focus',
  };
}

function resolveImportedAnnouncements(
  step: StepInput,
  byKey: Record<string, FlatDomNode>,
): Announcement[] {
  const out: Announcement[] = [];
  for (const entry of step.announcements ?? []) {
    let targetKey: string | null = null;
    if (entry.targetRef) {
      targetKey = byKey[entry.targetRef]?.key ?? null;
      if (!targetKey) {
        const byId = Object.values(byKey).find((node) => node.id === entry.targetRef);
        if (byId) {
          targetKey = byId.key;
        }
      }
    }
    out.push({ targetKey, polite: entry.polite ?? true, text: entry.text });
  }
  return out;
}

/**
 * Live announcements are derived deterministically by diffing consecutive
 * live-region text. Imported announcements are reconciled: an identical entry
 * confirms the derived one (it is not duplicated); an import-only entry is
 * appended.
 */
function deriveLiveAnnouncements(steps: ReplayStep[]): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const previous = i > 0 ? steps[i - 1]! : null;
    const merged: Announcement[] = [];
    for (const key of Object.keys(step.liveRegions).sort(compareStrings)) {
      const text = step.liveRegions[key]!;
      const before = previous?.liveRegions[key];
      if (text && before !== text) {
        merged.push({
          targetKey: key,
          polite: step.byKey[key]!.live !== 'assertive',
          text,
        });
      }
    }
    for (const imported of step.announcements) {
      const already = merged.some(
        (entry) => entry.targetKey === imported.targetKey && entry.text === imported.text,
      );
      if (!already) {
        merged.push(imported);
      }
    }
    merged.sort((a, b) => {
      const target = compareStrings(a.targetKey ?? '', b.targetKey ?? '');
      return target !== 0 ? target : compareStrings(a.text, b.text);
    });
    step.announcements = merged;
  }
}

/** Stable per-node token used inside the exported replay order. */
export function nodeReplayId(node: FlatDomNode): string {
  return hashString(`${node.preorder}:${node.stableId ?? node.tag}:${node.role}`);
}
