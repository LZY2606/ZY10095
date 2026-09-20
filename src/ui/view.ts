/**
 * Pure-ish DOM rendering for the workbench. Event handlers call back into
 * main.ts actions which mutate state through the deterministic core API.
 */

import type {
  ComparisonResult,
  DecisionProjection,
  Divergence,
  FlatDomNode,
  MatchEvidence,
  ReplayStep,
  StepMapping,
} from '../core/index.js';
import { formatNodeContext } from '../core/index.js';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      node.className = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function renderStepTimeline(
  result: ComparisonResult,
  selectedStep: number,
  onSelect: (step: number) => void,
): HTMLElement {
  const wrap = el('div', { class: 'steps' });
  const divergedSteps = new Set(result.divergences.map((d) => d.stepIndex));
  result.baseline.steps.forEach((step) => {
    const classes = ['step'];
    if (divergedSteps.has(step.index)) {
      classes.push('diverged');
    }
    if (step.index === result.earliestStep) {
      classes.push('earliest');
    }
    if (step.index === selectedStep) {
      classes.push('active');
    }
    const button = el('button', {
      class: classes.join(' '),
      title: JSON.stringify(step.action),
    });
    button.textContent = String(step.index);
    button.addEventListener('click', () => onSelect(step.index));
    wrap.append(button);
  });
  return wrap;
}

export function renderNodeTree(step: ReplayStep, title: string): HTMLElement {
  const panel = el('div', { class: 'side' });
  panel.append(el('h2', {}, title));
  const roots = step.nodes.filter((node) => node.parentKey === null);
  for (const root of roots) {
    panel.append(renderTreeNode(root, step, new Set()));
  }
  return panel;
}

function renderTreeNode(
  node: FlatDomNode,
  step: ReplayStep,
  ancestors: Set<string>,
): HTMLElement {
  const row = el('div', { class: 'mono' });
  const reachable = step.tabOrder.includes(node.key);
  const focused = step.focus?.toKey === node.key;
  const a11y = step.a11yByKey[node.key];
  const markers: string[] = [];
  if (focused) {
    markers.push('▶焦点');
  }
  if (reachable) {
    markers.push('⌨可达');
  }
  if (node.live && node.live !== 'off') {
    markers.push(`live:${node.live}`);
  }
  const text = `${formatNodeContext(node)} <${node.tag}> ${markers.join(' ')}`.trim();
  row.textContent = text;
  if (a11y && Object.keys(a11y.states).length > 0) {
    row.append(
      el('span', { class: 'muted' }, `  {${Object.entries(a11y.states)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ')}}`),
    );
  }
  const container = el('div');
  container.style.paddingLeft = '12px';
  container.append(row);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(node.key);
  for (const child of step.nodes.filter((candidate) => candidate.parentKey === node.key)) {
    container.append(renderTreeNode(child, step, nextAncestors));
  }
  return container;
}

export function renderMatchTable(
  mapping: StepMapping,
  baseline: ReplayStep,
  candidate: ReplayStep,
): HTMLElement {
  const panel = el('div');
  const table = el('table', { class: 'match-table' });
  table.append(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, '基线节点'),
        el('th', {}, '候选节点'),
        el('th', {}, '证据'),
        el('th', {}, '置信'),
      ),
    ),
  );
  const body = el('tbody');
  for (const match of mapping.matches) {
    const b = baseline.byKey[match.baselineKey]!;
    const c = candidate.byKey[match.candidateKey]!;
    const evidence = renderEvidence(match.evidence);
    body.append(
      el(
        'tr',
        {},
        el('td', { class: 'mono' }, formatNodeContext(b)),
        el('td', { class: 'mono' }, formatNodeContext(c)),
        el('td', {}, evidence),
        el(
          'td',
          { class: `conf-${match.evidence.confidence}` },
          match.evidence.confidence,
        ),
      ),
    );
  }
  table.append(body);
  panel.append(table);
  if (mapping.added.length > 0) {
    panel.append(
      el('p', { class: 'muted' }, `新增（未强行配对）：${mapping.added.join(', ')}`),
    );
  }
  if (mapping.removed.length > 0) {
    panel.append(
      el('p', { class: 'muted' }, `消失（未强行配对）：${mapping.removed.join(', ')}`),
    );
  }
  return panel;
}

function renderEvidence(evidence: MatchEvidence): HTMLElement {
  const items: string[] = [];
  if (evidence.stableId) items.push('stableId');
  if (evidence.testid) items.push('testid');
  if (evidence.domId) items.push('domId');
  if (evidence.role) items.push('role');
  if (evidence.name) items.push('name');
  if (evidence.controls) items.push('controls');
  if (evidence.ancestor > 0) items.push(`ancestor×${evidence.ancestor}`);
  return el('span', { class: 'mono' }, items.join(' + ') || '—');
}

export function statusBadge(
  divergenceId: string,
  projection: DecisionProjection,
): HTMLElement {
  const view = projection.views[divergenceId];
  const wrap = el('span', { class: 'row' });
  if (view?.conflict) {
    wrap.append(el('span', { class: 'badge conflict' }, '冲突'));
  } else if (view?.status === 'intentional') {
    wrap.append(el('span', { class: 'badge intentional' }, '有意'));
  } else if (view?.status === 'regression') {
    wrap.append(el('span', { class: 'badge regression' }, '回归'));
  }
  if (view?.activeExemptions.some((exemption) => exemption.status === 'active')) {
    wrap.append(el('span', { class: 'badge exempt' }, '豁免中'));
  }
  const invalid = view?.activeExemptions.find(
    (exemption) => exemption.status === 'invalid',
  );
  if (invalid) {
    wrap.append(
      el('span', { class: 'badge regression' }, `豁免失效:${invalid.invalidReason ?? ''}`),
    );
  }
  return wrap;
}

export function renderEvidenceBlock(divergence: Divergence): HTMLElement {
  const block = el('div', { class: 'evidence' });
  block.append(el('strong', {}, divergence.detail));
  const pre = el('pre');
  pre.textContent = JSON.stringify(
    { baseline: divergence.baseline, candidate: divergence.candidate },
    null,
    2,
  );
  block.append(pre);
  return block;
}

export function divergenceTitle(divergence: Divergence): string {
  const subject = divergence.name
    ? `${divergence.role} “${divergence.name}”`
    : divergence.role;
  return `第${divergence.stepIndex}步 · ${kindLabel(divergence.kind)} · ${subject}`;
}

export function kindLabel(kind: Divergence['kind']): string {
  const labels: Record<Divergence['kind'], string> = {
    'focus-destination': '焦点去向',
    'reachable-set': '可达路径',
    'semantic-state': '语义状态',
    finding: '规则证据',
    'new-node': '新增节点',
    'gone-node': '消失节点',
  };
  return labels[kind];
}
