/**
 * Cross-build node matching based on stable evidence.
 *
 * CSS paths / DOM position alone are never identity: elements remount and
 * shadow roots split the tree. A pair is accepted only when accumulated
 * evidence reaches ACCEPT_SCORE; conflicting explicit stable identifiers
 * forbid the pair outright. Unmatched nodes stay explicitly added / removed,
 * never force-paired.
 */

import type {
  Confidence,
  FlatDomNode,
  MatchEvidence,
  NodeMatch,
  ReplayStep,
  StepMapping,
} from './types.js';
import { compareStrings } from './deterministic.js';

const ACCEPT_SCORE = 0.4;

const W = {
  stableId: 0.45,
  testid: 0.3,
  domId: 0.12,
  role: 0.08,
  name: 0.22,
  controls: 0.08,
  ancestorEach: 0.05,
  ancestorCap: 3,
} as const;

export function ancestorContext(
  node: FlatDomNode,
  byKey: Record<string, FlatDomNode>,
): string[] {
  const out: string[] = [];
  let parentKey = node.parentKey;
  while (parentKey) {
    const parent = byKey[parentKey];
    if (!parent) {
      break;
    }
    out.push(formatNodeContext(parent));
    parentKey = parent.parentKey;
  }
  return out;
}

export function formatNodeContext(node: FlatDomNode): string {
  const stable = node.stableId ? `#${node.stableId}` : '';
  const name = node.name ? `[${node.name}]` : '';
  return `${node.role}${name}${stable}`;
}

function countMatchingAncestors(
  baseline: FlatDomNode,
  candidate: FlatDomNode,
  baselineByKey: Record<string, FlatDomNode>,
  candidateByKey: Record<string, FlatDomNode>,
): number {
  const a = ancestorContext(baseline, baselineByKey);
  const b = ancestorContext(candidate, candidateByKey);
  let count = 0;
  const limit = Math.min(a.length, b.length, W.ancestorCap);
  for (let i = 0; i < limit; i++) {
    if (a[i] === b[i]) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function scorePair(
  baseline: FlatDomNode,
  candidate: FlatDomNode,
  baselineByKey: Record<string, FlatDomNode>,
  candidateByKey: Record<string, FlatDomNode>,
): MatchEvidence | null {
  // Explicit stable identifiers that disagree cannot be the same node.
  if (
    baseline.stableId &&
    candidate.stableId &&
    baseline.stableId !== candidate.stableId
  ) {
    return null;
  }
  if (
    baseline.testid &&
    candidate.testid &&
    baseline.testid !== candidate.testid
  ) {
    return null;
  }

  const evidence: MatchEvidence = {
    stableId: !!baseline.stableId && baseline.stableId === candidate.stableId,
    testid: !!baseline.testid && baseline.testid === candidate.testid,
    domId: !!baseline.id && baseline.id === candidate.id,
    role: baseline.role === candidate.role,
    name: baseline.name.length > 0 && baseline.name === candidate.name,
    controls: !!baseline.controls && baseline.controls === candidate.controls,
    ancestor: countMatchingAncestors(
      baseline,
      candidate,
      baselineByKey,
      candidateByKey,
    ),
    score: 0,
    confidence: 'low',
  };

  let score = 0;
  if (evidence.stableId) {
    score += W.stableId;
  }
  if (evidence.testid) {
    score += W.testid;
  }
  if (evidence.domId) {
    score += W.domId;
  }
  if (evidence.role) {
    score += W.role;
  }
  if (evidence.name) {
    score += W.name;
  }
  if (evidence.controls) {
    score += W.controls;
  }
  score += Math.min(evidence.ancestor, W.ancestorCap) * W.ancestorEach;

  evidence.score = Number(score.toFixed(4));
  evidence.confidence = confidenceFor(evidence.score);
  return evidence;
}

function confidenceFor(score: number): Confidence {
  if (score >= 0.85) {
    return 'high';
  }
  if (score >= 0.6) {
    return 'medium';
  }
  return 'low';
}

/** Nodes that participate in keyboard / AT semantics. */
function semanticKeys(step: ReplayStep): Set<string> {
  const keys = new Set(step.a11yReachable);
  for (const key of step.tabOrder) {
    keys.add(key);
  }
  for (const key of Object.keys(step.liveRegions)) {
    keys.add(key);
  }
  if (step.focus?.toKey) {
    keys.add(step.focus.toKey);
  }
  return keys;
}

export function matchSteps(
  baseline: ReplayStep,
  candidate: ReplayStep,
): StepMapping {
  const baselineNodes = [...semanticKeys(baseline)]
    .sort()
    .map((key) => baseline.byKey[key]!)
    .filter((node): node is FlatDomNode => node !== undefined);
  const candidateNodes = [...semanticKeys(candidate)]
    .sort()
    .map((key) => candidate.byKey[key]!)
    .filter((node): node is FlatDomNode => node !== undefined);

  interface CandidatePair {
    bKey: string;
    cKey: string;
    evidence: MatchEvidence;
  }
  const pairs: CandidatePair[] = [];
  for (const b of baselineNodes) {
    for (const c of candidateNodes) {
      const evidence = scorePair(b, c, baseline.byKey, candidate.byKey);
      if (evidence && evidence.score >= ACCEPT_SCORE) {
        pairs.push({ bKey: b.key, cKey: c.key, evidence });
      }
    }
  }

  // One-to-one assignment: highest evidence first, with absolute key
  // tie-breaks so equal scores never depend on traversal order.
  pairs.sort((a, b) => {
    if (a.evidence.score !== b.evidence.score) {
      return b.evidence.score - a.evidence.score;
    }
    const left = compareStrings(a.bKey, b.bKey);
    return left !== 0 ? left : compareStrings(a.cKey, b.cKey);
  });

  const matchedBaseline = new Set<string>();
  const matchedCandidate = new Set<string>();
  const matches: NodeMatch[] = [];
  for (const pair of pairs) {
    if (matchedBaseline.has(pair.bKey) || matchedCandidate.has(pair.cKey)) {
      continue;
    }
    matchedBaseline.add(pair.bKey);
    matchedCandidate.add(pair.cKey);
    matches.push({
      baselineKey: pair.bKey,
      candidateKey: pair.cKey,
      evidence: pair.evidence,
    });
  }

  matches.sort((a, b) =>
    compareStrings(a.baselineKey, b.baselineKey) !== 0
      ? compareStrings(a.baselineKey, b.baselineKey)
      : compareStrings(a.candidateKey, b.candidateKey),
  );

  const added = candidateNodes
    .map((node) => node.key)
    .filter((key) => !matchedCandidate.has(key))
    .sort(compareStrings);
  const removed = baselineNodes
    .map((node) => node.key)
    .filter((key) => !matchedBaseline.has(key))
    .sort(compareStrings);

  return { stepIndex: baseline.index, matches, added, removed };
}
