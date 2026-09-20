/**
 * Applies one recorded keyboard sequence to both builds and locates the
 * earliest divergence. Color/style-only changes produce no divergence; only
 * operable paths and semantic state are compared.
 */

import type {
  CompareRequestInput,
  ComparisonResult,
  Divergence,
  Finding,
  FlatDomNode,
  ReplayedBuild,
} from './types.js';
import { RULE_VERSION } from './types.js';
import { canonicalJson, hashJson, hashString } from './deterministic.js';
import {
  assertSameActionSequence,
  nodeReplayId,
  replayBuild,
} from './replay.js';
import { matchSteps, ancestorContext } from './matching.js';
import { detectFindings } from './findings.js';

const SEMANTIC_STATE_KEYS = [
  'checked',
  'pressed',
  'expanded',
  'selected',
  'readonly',
  'required',
  'disabled',
  'value',
  'level',
  'current',
] as const;

export function compareBuilds(request: CompareRequestInput): ComparisonResult {
  if (request.ruleVersion !== undefined && request.ruleVersion !== RULE_VERSION) {
    throw new Error(
      `rule version mismatch: input declares ${request.ruleVersion}, engine is ${RULE_VERSION}`,
    );
  }
  const baseline = replayBuild(request.baseline);
  const candidate = replayBuild(request.candidate);
  assertSameActionSequence(baseline, candidate);

  const mappings = baseline.steps.map((step, index) =>
    matchSteps(step, candidate.steps[index]!),
  );
  const baselineFindings = detectFindings(baseline);
  const candidateFindings = detectFindings(candidate);

  const divergences: Divergence[] = [];
  const reportedStructural = new Set<string>();
  for (let index = 0; index < baseline.steps.length; index++) {
    divergences.push(
      ...compareStep(
        baseline,
        candidate,
        index,
        mappings[index]!,
        baselineFindings,
        candidateFindings,
        reportedStructural,
      ),
    );
  }

  divergences.sort((a, b) =>
    a.stepIndex === b.stepIndex
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.stepIndex - b.stepIndex,
  );

  const earliestStep = divergences.length > 0 ? divergences[0]!.stepIndex : null;
  const inputFingerprint = hashJson({
    ruleVersion: RULE_VERSION,
    baseline: stripSide(request.baseline),
    candidate: stripSide(request.candidate),
  });

  return {
    ruleVersion: RULE_VERSION,
    baselineFingerprint: baseline.fingerprint,
    candidateFingerprint: candidate.fingerprint,
    baseline,
    candidate,
    mappings,
    findings: { baseline: baselineFindings, candidate: candidateFindings },
    divergences,
    earliestStep,
    inputFingerprint,
  };
}

/** Side labels are not part of identity; the content is. */
function stripSide(build: CompareRequestInput['baseline']): unknown {
  return {
    fingerprint: build.fingerprint,
    steps: build.steps,
  };
}

function compareStep(
  baseline: ReplayedBuild,
  candidate: ReplayedBuild,
  index: number,
  mapping: ReturnType<typeof matchSteps>,
  baselineFindings: Finding[],
  candidateFindings: Finding[],
  reportedStructural: Set<string>,
): Divergence[] {
  const bStep = baseline.steps[index]!;
  const cStep = candidate.steps[index]!;
  const out: Divergence[] = [];

  const pairByBaseline = new Map(
    mapping.matches.map((match) => [match.baselineKey, match.candidateKey]),
  );

  // 1. Focus destination.
  const bFocus = bStep.focus?.toKey ?? null;
  const cFocus = cStep.focus?.toKey ?? null;
  const pairedFocus = bFocus ? pairByBaseline.get(bFocus) ?? null : null;
  if (pairedFocus !== cFocus && !(bFocus === null && cFocus === null)) {
    const subjectKey = bFocus ?? cFocus ?? `step-${index}-focus`;
    const subject = bFocus
      ? bStep.byKey[bFocus]
      : cFocus
        ? cStep.byKey[cFocus]
        : undefined;
    out.push(
      makeDivergence(bStep, cStep, subjectKey, subject, 'focus-destination', {
        baseline: bFocus
          ? describeFocus(bStep, bFocus)
          : { to: null, reason: bStep.focus?.reason ?? null },
        candidate: cFocus
          ? describeFocus(cStep, cFocus)
          : { to: null, reason: cStep.focus?.reason ?? null },
      }, `Keyboard focus lands on different targets after ${canonicalAction(bStep.action)}.`),
    );
  }

  // 2. Semantic state of every matched node.
  for (const match of mapping.matches) {
    const bNode = bStep.byKey[match.baselineKey]!;
    const cNode = cStep.byKey[match.candidateKey]!;
    const bSemantic = semanticState(bStep, bNode);
    const cSemantic = semanticState(cStep, cNode);
    if (canonicalJson(bSemantic) !== canonicalJson(cSemantic)) {
      out.push(
        makeDivergence(
          bStep,
          cStep,
          bNode.key,
          bNode,
          'semantic-state',
          { baseline: bSemantic, candidate: cSemantic },
          'Role/name/state exposed to assistive technology differs.',
        ),
      );
    }
  }

  // 3. Reachable-set membership for matched nodes (operable path change).
  const bReachable = new Set(bStep.tabOrder);
  const cReachable = new Set(cStep.tabOrder);
  for (const match of mapping.matches) {
    const bIn = bReachable.has(match.baselineKey);
    const cIn = cReachable.has(match.candidateKey);
    if (bIn !== cIn) {
      const bNode = bStep.byKey[match.baselineKey]!;
      out.push(
        makeDivergence(
          bStep,
          cStep,
          bNode.key,
          bNode,
          'reachable-set',
          {
            baseline: { keyboardReachable: bIn },
            candidate: { keyboardReachable: cIn },
          },
          bIn
            ? 'Node left the keyboard tab order in the candidate.'
            : 'Node entered the keyboard tab order in the candidate.',
        ),
      );
    }
  }

  // 4. Rule findings present on only one side at this step.
  const bAtStep = baselineFindings.filter((finding) => finding.stepIndex === index);
  const cAtStep = candidateFindings.filter((finding) => finding.stepIndex === index);
  const cSignatures = new Set(cAtStep.map((finding) => finding.signature));
  const bSignatures = new Set(bAtStep.map((finding) => finding.signature));
  for (const finding of bAtStep) {
    if (!cSignatures.has(finding.signature)) {
      out.push(findingDivergence(bStep, cStep, finding, 'baseline'));
    }
  }
  for (const finding of cAtStep) {
    if (!bSignatures.has(finding.signature)) {
      const divergence = findingDivergence(bStep, cStep, finding, 'candidate');
      out.push(divergence);
      reportedStructural.add(`new:${divergence.subjectKey}`);
      reportedStructural.add(`gone:${divergence.subjectKey}`);
    }
  }

  // 5. Added / removed nodes that could not be paired with stable evidence.
  // A node already represented by rule evidence (e.g. an unreachable popup)
  // is not duplicated as a plain new node.
  const findingSubjects = new Set(
    out.filter((entry) => entry.kind === 'finding').map((entry) => entry.subjectKey),
  );
  for (const key of mapping.added) {
    const structuralKey = `new:${key}`;
    if (findingSubjects.has(key) || reportedStructural.has(structuralKey)) {
      continue;
    }
    reportedStructural.add(structuralKey);
    const node = cStep.byKey[key]!;
    out.push(
      makeDivergence(
        bStep,
        cStep,
        key,
        node,
        'new-node',
        {
          baseline: null,
          candidate: { semantic: semanticState(cStep, node) },
        },
        'Candidate exposes an unmatched node; retained as new, not force-paired.',
      ),
    );
  }
  for (const key of mapping.removed) {
    const structuralKey = `gone:${key}`;
    if (findingSubjects.has(key) || reportedStructural.has(structuralKey)) {
      continue;
    }
    reportedStructural.add(structuralKey);
    const node = bStep.byKey[key]!;
    out.push(
      makeDivergence(
        bStep,
        cStep,
        key,
        node,
        'gone-node',
        {
          baseline: { semantic: semanticState(bStep, node) },
          candidate: null,
        },
        'Baseline node has no stable-evidence counterpart; retained as gone.',
      ),
    );
  }

  return out;
}

function canonicalAction(action: Record<string, string | number | boolean>): string {
  return Object.keys(action)
    .sort()
    .map((key) => `${key}:${String(action[key])}`)
    .join(' ');
}

function describeFocus(step: ReplayedBuild['steps'][number], key: string) {
  const node = step.byKey[key]!;
  return {
    to: key,
    role: node.role,
    name: node.name,
  };
}

function semanticState(
  step: ReplayedBuild['steps'][number],
  node: FlatDomNode,
): Record<string, unknown> {
  const a11y = step.a11yByKey[node.key];
  const states: Record<string, unknown> = {};
  const source = a11y?.states ?? node.states;
  for (const key of SEMANTIC_STATE_KEYS) {
    if (source[key] !== undefined) {
      states[key] = source[key];
    }
  }
  return {
    role: a11y?.role ?? node.role,
    name: a11y?.name ?? node.name,
    live: node.live,
    states,
  };
}

function makeDivergence(
  bStep: ReplayedBuild['steps'][number],
  cStep: ReplayedBuild['steps'][number],
  subjectKey: string,
  subject: FlatDomNode | undefined,
  kind: Divergence['kind'],
  values: { baseline: unknown; candidate: unknown },
  detail: string,
): Divergence {
  const baselineNode = bStep.byKey[subjectKey];
  const candidateNode = cStep.byKey[subjectKey];
  const anchor = baselineNode ?? candidateNode ?? subject;
  const ancestorContext = anchor
    ? anchor === baselineNode
      ? ancestorContextOf(bStep, subjectKey)
      : ancestorContextOf(cStep, subjectKey)
    : [];
  const id = hashString(
    [
      bStep.index,
      kind,
      subjectKey,
      hashJson(values),
    ].join('|'),
  );
  return {
    id,
    stepIndex: bStep.index,
    kind,
    subjectKey,
    role: anchor?.role ?? 'unknown',
    name: anchor?.name ?? '',
    ancestorContext,
    baseline: (values.baseline ?? {}) as Record<string, unknown>,
    candidate: (values.candidate ?? {}) as Record<string, unknown>,
    baselineFingerprint: bStep.fingerprint,
    candidateFingerprint: cStep.fingerprint,
    detail,
  };
}

function ancestorContextOf(
  step: ReplayedBuild['steps'][number],
  key: string,
): string[] {
  const node = step.byKey[key];
  return node ? ancestorContext(node, step.byKey) : [];
}

function findingDivergence(
  bStep: ReplayedBuild['steps'][number],
  cStep: ReplayedBuild['steps'][number],
  finding: Finding,
  onlyOn: 'baseline' | 'candidate',
): Divergence {
  const subjectKey =
    typeof finding.evidence.dialogKey === 'string'
      ? finding.evidence.dialogKey
      : typeof finding.evidence.popupKey === 'string'
        ? finding.evidence.popupKey
        : typeof finding.evidence.regionKey === 'string'
          ? finding.evidence.regionKey
          : `finding-${finding.signature}`;
  const step = onlyOn === 'baseline' ? bStep : cStep;
  const node = step.byKey[subjectKey];
  const id = hashString(`${bStep.index}|finding|${finding.signature}`);
  const present = { code: finding.code, signature: finding.signature, evidence: finding.evidence };
  const absent = { code: finding.code, signature: finding.signature, present: false };
  return {
    id,
    stepIndex: bStep.index,
    kind: 'finding',
    subjectKey: String(subjectKey),
    role: node?.role ?? String(finding.evidence.role ?? 'unknown'),
    name: node?.name ?? String(finding.evidence.name ?? ''),
    ancestorContext: node ? ancestorContext(node, step.byKey) : [],
    baseline: onlyOn === 'baseline' ? (present as unknown as Record<string, unknown>) : absent,
    candidate: onlyOn === 'candidate' ? (present as unknown as Record<string, unknown>) : absent,
    baselineFingerprint: bStep.fingerprint,
    candidateFingerprint: cStep.fingerprint,
    detail:
      onlyOn === 'baseline'
        ? `Rule ${finding.code} fires only in the baseline.`
        : `Rule ${finding.code} fires only in the candidate.`,
  };
}

export function replayOrder(build: ReplayedBuild): string[][] {
  return build.steps.map((step) =>
    step.tabOrder.map((key) => nodeReplayId(step.byKey[key]!)),
  );
}
