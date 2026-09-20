/**
 * DOM snapshot flattening and accessible-name resolution.
 *
 * Shadow hosts are flattened into a single tree (the importer supplies the
 * composed light+shadow order as nested children), so tab order and ancestor
 * context work across shadow boundaries. Stable identity is whatever the
 * importer explicitly provides (stableId / testid); the generated `p<n>` key
 * is a preorder position, never cross-build identity.
 */

import type { DomNodeInput, FlatDomNode } from './types.js';
import { compareStrings } from './deterministic.js';

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link',
  button: 'button',
  input: 'textbox',
  textarea: 'textbox',
  select: 'combobox',
  option: 'option',
  nav: 'navigation',
  main: 'main',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  dialog: 'dialog',
  aside: 'complementary',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  img: 'img',
  table: 'table',
  svg: 'graphics-document',
};

const NATIVE_FOCUSABLE_TAGS = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'summary',
]);

export function implicitRole(tag: string): string {
  return IMPLICIT_ROLES[tag] ?? tag;
}

export function isNativeFocusableTag(tag: string): boolean {
  return NATIVE_FOCUSABLE_TAGS.has(tag);
}

export function flattenDom(root: DomNodeInput): FlatDomNode[] {
  const out: FlatDomNode[] = [];
  const raw: DomNodeInput[] = [];
  let preorder = 0;

  const visit = (node: DomNodeInput, parentKey: string | null): string => {
    const own = preorder;
    const stableId = node.stableId ?? node.testid ?? null;
    const key = stableId ?? `p${own}`;
    preorder += 1;
    raw.push(node);

    const role = node.role ?? implicitRole(node.tag);
    const disabled = isDisabled(node);
    out.push({
      key,
      preorder: own,
      parentKey,
      stableId,
      tag: node.tag,
      role,
      name: '',
      id: node.id ?? null,
      testid: node.testid ?? null,
      controls: node.controls ?? null,
      tabindex: node.tabindex ?? null,
      focusable: isFocusable(node, role, disabled),
      disabled,
      hidden: node.hidden === true,
      ariaHidden: node.ariaHidden === true,
      live: node.live ?? null,
      text: node.text ?? '',
      states: normalizeStates(node.states),
      shadowHost: node.shadowHost === true,
    });

    for (const child of node.children ?? []) {
      visit(child, key);
    }
    return key;
  };

  visit(root, null);

  const index = indexRawTree(root);
  for (let i = 0; i < out.length; i++) {
    out[i]!.name = computeName(raw[i]!, index);
  }
  return out;
}

export function isDisabled(node: DomNodeInput): boolean {
  if (node.disabled === true) {
    return true;
  }
  const state = node.states?.disabled;
  return state === true || state === 'true';
}

function isFocusable(
  node: DomNodeInput,
  role: string,
  disabled: boolean,
): boolean {
  if (disabled || node.hidden === true || node.ariaHidden === true) {
    return false;
  }
  if (role === 'presentation' || role === 'none') {
    return false;
  }
  if (typeof node.tabindex === 'number') {
    return node.tabindex >= 0;
  }
  if (node.focusable === true) {
    return true;
  }
  if (isNativeFocusableTag(node.tag)) {
    return true;
  }
  // Anchors are natively focusable only with an href; importers signal that
  // with focusable:true or an explicit tabindex.
  return false;
}

export function normalizeStates(
  states: Record<string, string | boolean> | undefined,
): Record<string, string | boolean> {
  if (!states) {
    return {};
  }
  const out: Record<string, string | boolean> = {};
  for (const key of Object.keys(states).sort(compareStrings)) {
    const value = states[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

interface RawTreeIndex {
  byStable: Map<string, DomNodeInput>;
  byId: Map<string, DomNodeInput>;
}

function indexRawTree(root: DomNodeInput): RawTreeIndex {
  const byStable = new Map<string, DomNodeInput>();
  const byId = new Map<string, DomNodeInput>();
  const walk = (node: DomNodeInput): void => {
    const stable = node.stableId ?? node.testid;
    if (stable) {
      byStable.set(stable, node);
    }
    if (node.id) {
      byId.set(node.id, node);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(root);
  return { byStable, byId };
}

export function subtreeText(node: DomNodeInput): string {
  const parts: string[] = [];
  const walk = (current: DomNodeInput): void => {
    if (current.text) {
      parts.push(current.text);
    }
    for (const child of current.children ?? []) {
      walk(child);
    }
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function computeName(node: DomNodeInput, index: RawTreeIndex): string {
  if (node.accessibleName) {
    return node.accessibleName.trim();
  }
  if (node.labelledby && node.labelledby.length > 0) {
    const pieces = node.labelledby.map((ref) => {
      const target = index.byStable.get(ref) ?? index.byId.get(ref);
      return target ? subtreeText(target) : '';
    });
    const joined = pieces.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) {
      return joined;
    }
  }
  const labelled = node.states?.label;
  if (typeof labelled === 'string' && labelled.trim()) {
    return labelled.trim();
  }
  if (node.text) {
    return node.text.replace(/\s+/g, ' ').trim();
  }
  return '';
}
