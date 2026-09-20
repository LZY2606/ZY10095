/**
 * Append-only decision ledger.
 *
 * Human decisions (classification / exemption / undo) are immutable events.
 * Undoing writes a new event; history is never deleted. Two researchers
 * classifying the same divergence differently produce status "conflict"
 * instead of overwriting each other. Every event records the operator, the
 * reason, and the ledger versions before/after. Timestamps are stored only
 * when explicitly supplied — the wall clock is never read.
 */

import type {
  BatchOperation,
  ComparisonResult,
  DecisionEvent,
  DecisionKind,
  DecisionLedger,
  DecisionProjection,
  Divergence,
  DivergenceDecisionView,
  ExemptionBinding,
  ExemptionView,
  InvalidationReason,
} from './types.js';
import { hashJson, hashString } from './deterministic.js';
import { ancestorContext } from './matching.js';

export interface LedgerError extends Error {
  code:
    | 'UNKNOWN_DIVERGENCE'
    | 'BAD_RANGE'
    | 'EMPTY_OPERATOR'
    | 'EMPTY_REASON'
    | 'NOTHING_TO_UNDO'
    | 'UNDO_FORBIDDEN'
    | 'IMMUTABLE_EVENT'
    | 'FINGERPRINT_MISMATCH'
    | 'EMPTY_BATCH';
}

export function ledgerError(
  code: LedgerError['code'],
  message: string,
): LedgerError {
  const error = new Error(message) as LedgerError;
  error.code = code;
  return error;
}

export function emptyLedger(result: ComparisonResult): DecisionLedger {
  return {
    inputFingerprint: result.inputFingerprint,
    ruleVersion: result.ruleVersion,
    events: [],
    version: null,
  };
}

function nextSeq(events: DecisionEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
}

function validateOperator(operator: string): void {
  if (!operator.trim()) {
    throw ledgerError('EMPTY_OPERATOR', 'operator is required');
  }
}

function validateReason(reason: string): void {
  if (!reason.trim()) {
    throw ledgerError('EMPTY_REASON', 'reason is required');
  }
}

function requireDivergence(
  result: ComparisonResult,
  divergenceId: string,
): Divergence {
  const divergence = result.divergences.find((entry) => entry.id === divergenceId);
  if (!divergence) {
    throw ledgerError(
      'UNKNOWN_DIVERGENCE',
      `unknown divergence ${divergenceId}`,
    );
  }
  return divergence;
}

function makeBinding(
  result: ComparisonResult,
  divergence: Divergence,
  _rangeStart: number,
  _rangeEnd: number,
): ExemptionBinding {
  const bStep = result.baseline.steps[divergence.stepIndex]!;
  const cStep = result.candidate.steps[divergence.stepIndex]!;
  const mapping = result.mappings[divergence.stepIndex]!;
  const pairedCandidateKey =
    mapping.matches.find((match) => match.baselineKey === divergence.subjectKey)
      ?.candidateKey ??
    (divergence.kind === 'new-node' || divergence.kind === 'finding'
      ? divergence.subjectKey
      : null);
  const bNode = bStep.byKey[divergence.subjectKey];
  const cNode = pairedCandidateKey ? cStep.byKey[pairedCandidateKey] : undefined;
  return {
    role: divergence.role,
    accessibleName: divergence.name,
    ancestorContext: divergence.ancestorContext,
    baselineRole: bNode?.role ?? divergence.role,
    candidateRole: cNode?.role ?? divergence.role,
    baselineName: bNode?.name ?? divergence.name,
    candidateName: cNode?.name ?? divergence.name,
    baselineAncestorContext: bNode ? ancestorContext(bNode, bStep.byKey) : divergence.ancestorContext,
    candidateAncestorContext: cNode ? ancestorContext(cNode, cStep.byKey) : divergence.ancestorContext,
    baselineFingerprint: result.baselineFingerprint,
    candidateFingerprint: result.candidateFingerprint,
    ruleVersion: result.ruleVersion,
    subjectKey: divergence.subjectKey,
    stepIndex: divergence.stepIndex,
  };
}

function resolveRange(
  divergence: Divergence,
  rangeStart: number | undefined,
  rangeEnd: number | undefined,
  totalSteps: number,
): { start: number; end: number } {
  const start = rangeStart ?? divergence.stepIndex;
  const end = rangeEnd ?? totalSteps - 1;
  if (
    start < 0 ||
    end < start ||
    end >= totalSteps ||
    start > divergence.stepIndex
  ) {
    throw ledgerError(
      'BAD_RANGE',
      `invalid exemption range ${start}..${end}`,
    );
  }
  return { start, end };
}

function appendEvent(
  ledger: DecisionLedger,
  draft: Omit<DecisionEvent, 'seq' | 'id' | 'beforeVersion' | 'afterVersion' | 'inputFingerprint' | 'ruleVersion'>,
): DecisionLedger {
  const seq = nextSeq(ledger.events);
  const id = hashString(
    `${ledger.inputFingerprint}|${seq}|${draft.type}|${draft.divergenceId}`,
  );
  const event: DecisionEvent = {
    ...draft,
    seq,
    id,
    beforeVersion: ledger.version,
    afterVersion: '',
    inputFingerprint: ledger.inputFingerprint,
    ruleVersion: ledger.ruleVersion,
  };
  event.afterVersion = hashJson({
    parent: ledger.version,
    seq: event.seq,
    type: event.type,
    divergenceId: event.divergenceId,
    kind: event.kind ?? null,
    reason: event.reason,
    operator: event.operator,
    rangeStart: event.rangeStart ?? null,
    rangeEnd: event.rangeEnd ?? null,
    binding: event.binding ?? null,
    undoesSeq: event.undoesSeq ?? null,
    clientTime: event.clientTime ?? null,
  });
  return {
    ...ledger,
    events: [...ledger.events, event],
    version: event.afterVersion,
  };
}

export function classify(
  ledger: DecisionLedger,
  result: ComparisonResult,
  params: {
    divergenceId: string;
    kind: DecisionKind;
    reason: string;
    operator: string;
    clientTime?: string;
  },
): DecisionLedger {
  validateOperator(params.operator);
  validateReason(params.reason);
  requireDivergence(result, params.divergenceId);
  return appendEvent(ledger, {
    type: 'classified',
    divergenceId: params.divergenceId,
    kind: params.kind,
    reason: params.reason,
    operator: params.operator,
    ...(params.clientTime ? { clientTime: params.clientTime } : {}),
  });
}

export function exempt(
  ledger: DecisionLedger,
  result: ComparisonResult,
  params: {
    divergenceId: string;
    reason: string;
    operator: string;
    rangeStart?: number;
    rangeEnd?: number;
    clientTime?: string;
  },
): DecisionLedger {
  validateOperator(params.operator);
  validateReason(params.reason);
  const divergence = requireDivergence(result, params.divergenceId);
  const totalSteps = result.baseline.steps.length;
  const range = resolveRange(divergence, params.rangeStart, params.rangeEnd, totalSteps);
  const binding = makeBinding(result, divergence, range.start, range.end);
  return appendEvent(ledger, {
    type: 'exempted',
    divergenceId: divergence.id,
    reason: params.reason,
    operator: params.operator,
    rangeStart: range.start,
    rangeEnd: range.end,
    binding,
    ...(params.clientTime ? { clientTime: params.clientTime } : {}),
  });
}

/**
 * Undo an event. Only the original operator can undo. The target must be the
 * latest live event for its divergence. A new append-only event records it.
 */
export function undo(
  ledger: DecisionLedger,
  result: ComparisonResult,
  params: { eventSeq: number; operator: string; reason: string; clientTime?: string },
): DecisionLedger {
  validateOperator(params.operator);
  validateReason(params.reason);
  const target = ledger.events.find((event) => event.seq === params.eventSeq);
  if (!target || target.type === 'undone') {
    throw ledgerError('NOTHING_TO_UNDO', `no live event at seq ${params.eventSeq}`);
  }
  if (target.operator !== params.operator) {
    throw ledgerError(
      'UNDO_FORBIDDEN',
      'only the original operator may undo their decision',
    );
  }
  const undoneSeqs = new Set(
    ledger.events
      .filter((event) => event.type === 'undone')
      .map((event) => event.undoesSeq!),
  );
  if (undoneSeqs.has(target.seq)) {
    throw ledgerError('NOTHING_TO_UNDO', `event ${target.seq} is already undone`);
  }
  requireDivergence(result, target.divergenceId);
  return appendEvent(ledger, {
    type: 'undone',
    divergenceId: target.divergenceId,
    reason: params.reason,
    operator: params.operator,
    undoesSeq: target.seq,
    ...(params.clientTime ? { clientTime: params.clientTime } : {}),
  });
}

/**
 * Apply several operations transactionally. Validation runs against a
 * speculative ledger first; on any failure the original ledger is returned
 * untouched (no visible partial results).
 */
export function applyBatch(
  ledger: DecisionLedger,
  result: ComparisonResult,
  operations: BatchOperation[],
): DecisionLedger {
  if (operations.length === 0) {
    throw ledgerError('EMPTY_BATCH', 'batch contains no operations');
  }
  let current = ledger;
  for (const operation of operations) {
    if (operation.type === 'classified') {
      if (operation.kind !== 'intentional' && operation.kind !== 'regression') {
        throw ledgerError('EMPTY_REASON', 'classification kind is required');
      }
      current = classify(current, result, {
        divergenceId: operation.divergenceId,
        kind: operation.kind,
        reason: operation.reason,
        operator: operation.operator,
        ...(operation.clientTime ? { clientTime: operation.clientTime } : {}),
      });
    } else {
      current = exempt(current, result, {
        divergenceId: operation.divergenceId,
        reason: operation.reason,
        operator: operation.operator,
        ...(operation.rangeStart !== undefined ? { rangeStart: operation.rangeStart } : {}),
        ...(operation.rangeEnd !== undefined ? { rangeEnd: operation.rangeEnd } : {}),
        ...(operation.clientTime ? { clientTime: operation.clientTime } : {}),
      });
    }
  }
  return current;
}

export function projectLedger(
  ledger: DecisionLedger,
  result: ComparisonResult,
): DecisionProjection {
  const undoneSeqs = new Set(
    ledger.events
      .filter((event) => event.type === 'undone')
      .map((event) => event.undoesSeq!),
  );
  const live = ledger.events.filter(
    (event) => event.type !== 'undone' && !undoneSeqs.has(event.seq),
  );

  const views: Record<string, DivergenceDecisionView> = {};
  const ensureView = (divergenceId: string): DivergenceDecisionView => {
    let view: DivergenceDecisionView | undefined = views[divergenceId];
    if (!view) {
      view = {
        divergenceId,
        status: 'unclassified',
        classifications: [],
        conflict: false,
        activeExemptions: [],
      };
      views[divergenceId] = view;
    }
    return view;
  };
  for (const divergence of result.divergences) {
    ensureView(divergence.id);
  }

  for (const event of live) {
    const view = ensureView(event.divergenceId);
    if (event.type === 'classified' && event.kind) {
      view.classifications.push({
        operator: event.operator,
        kind: event.kind,
        reason: event.reason,
        eventId: event.id,
      });
    }
  }

  const exemptions: ExemptionView[] = [];
  for (const event of live) {
    if (event.type !== 'exempted' || !event.binding) {
      continue;
    }
    const status = revalidateExemption(event, result);
    const view: ExemptionView = {
      eventId: event.id,
      divergenceId: event.divergenceId,
      operator: event.operator,
      reason: event.reason,
      rangeStart: event.rangeStart ?? event.binding.stepIndex,
      rangeEnd: event.rangeEnd ?? result.baseline.steps.length - 1,
      binding: event.binding,
      status: status.status,
      invalidReason: status.reason,
    };
    exemptions.push(view);
    ensureView(event.divergenceId).activeExemptions.push(view);
  }

  for (const view of Object.values(views)) {
    const kinds = new Set(view.classifications.map((entry) => entry.kind));
    view.conflict = kinds.size > 1;
    if (view.conflict) {
      view.status = 'conflict';
    } else {
      const only = view.classifications[view.classifications.length - 1]?.kind;
      view.status = only ?? 'unclassified';
    }
  }

  return { version: ledger.version, views, exemptions };
}

function revalidateExemption(
  event: DecisionEvent,
  result: ComparisonResult,
): { status: 'active' | 'invalid'; reason: InvalidationReason | null } {
  const divergence = result.divergences.find(
    (entry) => entry.id === event.divergenceId,
  );
  if (!divergence) {
    return { status: 'invalid', reason: 'node-moved' };
  }
  const binding = event.binding!;
  if (
    binding.baselineFingerprint !== result.baselineFingerprint ||
    binding.candidateFingerprint !== result.candidateFingerprint
  ) {
    return { status: 'invalid', reason: 'fingerprint-changed' };
  }
  if (binding.ruleVersion !== result.ruleVersion) {
    return { status: 'invalid', reason: 'fingerprint-changed' };
  }
  const start = event.rangeStart ?? binding.stepIndex;
  const end = event.rangeEnd ?? result.baseline.steps.length - 1;
  if (binding.stepIndex < start || binding.stepIndex > end) {
    return { status: 'invalid', reason: 'out-of-range' };
  }
  if (divergence.role !== binding.role) {
    return { status: 'invalid', reason: 'role-changed' };
  }
  if (divergence.name !== binding.accessibleName) {
    return { status: 'invalid', reason: 'name-changed' };
  }
  const bStep = result.baseline.steps[divergence.stepIndex]!;
  const cStep = result.candidate.steps[divergence.stepIndex]!;
  const mapping = result.mappings[divergence.stepIndex]!;
  const candidateKey =
    mapping.matches.find((match) => match.baselineKey === divergence.subjectKey)
      ?.candidateKey ??
    (divergence.kind === 'new-node' || divergence.kind === 'finding'
      ? divergence.subjectKey
      : null);
  const bNode = bStep.byKey[divergence.subjectKey];
  const cNode = candidateKey ? cStep.byKey[candidateKey] : undefined;
  const bRole = bNode?.role ?? divergence.role;
  const cRole = cNode?.role ?? divergence.role;
  const bName = bNode?.name ?? divergence.name;
  const cName = cNode?.name ?? divergence.name;
  if (bRole !== binding.baselineRole || cRole !== binding.candidateRole) {
    return { status: 'invalid', reason: 'role-changed' };
  }
  if (bName !== binding.baselineName || cName !== binding.candidateName) {
    return { status: 'invalid', reason: 'name-changed' };
  }
  const bContext = bNode ? ancestorContext(bNode, bStep.byKey) : divergence.ancestorContext;
  const cContext = cNode ? ancestorContext(cNode, cStep.byKey) : divergence.ancestorContext;
  if (
    canonicalContext(bContext) !== canonicalContext(binding.baselineAncestorContext) ||
    canonicalContext(cContext) !== canonicalContext(binding.candidateAncestorContext)
  ) {
    return { status: 'invalid', reason: 'node-moved' };
  }
  return { status: 'active', reason: null };
}

function canonicalContext(context: string[]): string {
  return [...context].join(' > ');
}

export function bindingPreview(
  result: ComparisonResult,
  divergenceId: string,
): ExemptionBinding | null {
  const divergence = result.divergences.find(
    (entry) => entry.id === divergenceId,
  );
  if (!divergence) {
    return null;
  }
  return makeBinding(result, divergence, divergence.stepIndex, divergence.stepIndex);
}

export { ancestorContext };
