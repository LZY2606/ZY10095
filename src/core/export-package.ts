/**
 * Self-contained export packages: original request, mappings, findings,
 * divergences, replay order and the decision ledger. Offline replay must
 * reproduce, in the same order, exactly the replay order recorded here.
 */

import type {
  CompareRequestInput,
  ComparisonResult,
  DecisionLedger,
  ExportPackage,
} from './types.js';
import { canonicalJson } from './deterministic.js';
import { assertSameActionSequence, replayBuild } from './replay.js';
import { compareBuilds, replayOrder } from './compare.js';

export interface ReplayVerification {
  ok: boolean;
  inputFingerprint: string;
  details: {
    baselineOrderMatches: boolean;
    candidateOrderMatches: boolean;
    divergencesMatch: boolean;
  };
}

export function createExportPackage(
  request: CompareRequestInput,
  result: ComparisonResult,
  ledger: DecisionLedger,
  options: { createdAt?: string } = {},
): ExportPackage {
  return {
    format: 'pairwise-gsb-export',
    formatVersion: 1,
    ruleVersion: result.ruleVersion,
    inputFingerprint: result.inputFingerprint,
    request,
    result: {
      mappings: result.mappings,
      findings: result.findings,
      divergences: result.divergences,
      earliestStep: result.earliestStep,
      replayOrder: {
        baseline: replayOrder(result.baseline),
        candidate: replayOrder(result.candidate),
      },
    },
    ledger,
    createdAt: options.createdAt ?? null,
  };
}

/**
 * Re-run the whole pipeline from the saved request and confirm identical
 * output. Takes no external state; current time cannot influence the result.
 */
export function verifyOfflineReplay(pkg: ExportPackage): ReplayVerification {
  const replayed = compareBuilds(pkg.request);
  const baselineOrder = replayOrder(replayed.baseline);
  const candidateOrder = replayOrder(replayed.candidate);

  const baselineOrderMatches =
    canonicalJson(baselineOrder) === canonicalJson(pkg.result.replayOrder.baseline);
  const candidateOrderMatches =
    canonicalJson(candidateOrder) === canonicalJson(pkg.result.replayOrder.candidate);
  const divergencesMatch =
    canonicalJson(replayed.divergences) === canonicalJson(pkg.result.divergences);

  return {
    ok:
      baselineOrderMatches &&
      candidateOrderMatches &&
      divergencesMatch &&
      replayed.inputFingerprint === pkg.inputFingerprint,
    inputFingerprint: replayed.inputFingerprint,
    details: {
      baselineOrderMatches,
      candidateOrderMatches,
      divergencesMatch,
    },
  };
}
