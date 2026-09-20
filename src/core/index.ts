/**
 * Public workbench API. Pure, deterministic functions over saved JSON inputs.
 */

export * from './types.js';
export {
  canonicalJson,
  hashJson,
  hashString,
  compareStrings,
} from './deterministic.js';
export {
  replayBuild,
  assertSameActionSequence,
  replayError,
  nodeReplayId,
  type ReplayError,
} from './replay.js';
export { flattenDom, subtreeText } from './dom-tree.js';
export { matchSteps, ancestorContext, formatNodeContext } from './matching.js';
export { detectFindings } from './findings.js';
export {
  compareBuilds,
  replayOrder,
} from './compare.js';
export {
  emptyLedger,
  classify,
  exempt,
  undo,
  applyBatch,
  projectLedger,
  bindingPreview,
  ledgerError,
  type LedgerError,
} from './ledger.js';
export {
  createExportPackage,
  verifyOfflineReplay,
  type ReplayVerification,
} from './export-package.js';

import { compareBuilds } from './compare.js';
import {
  emptyLedger,
  classify,
  exempt,
  undo,
  applyBatch,
  projectLedger,
} from './ledger.js';
import {
  createExportPackage,
  verifyOfflineReplay,
} from './export-package.js';
import type {
  BatchOperation,
  CompareRequestInput,
  ComparisonResult,
  DecisionKind,
  DecisionLedger,
  DecisionProjection,
  ExportPackage,
} from './types.js';

export interface WorkbenchSession {
  result: ComparisonResult;
  ledger: DecisionLedger;
}

/** Thin convenience wrapper; the functions above remain independently usable. */
export class Workbench {
  readonly result: ComparisonResult;
  ledger: DecisionLedger;

  constructor(request: CompareRequestInput, ledger?: DecisionLedger) {
    this.result = compareBuilds(request);
    this.ledger = ledger ?? emptyLedger(this.result);
    if (ledger && ledger.inputFingerprint !== this.result.inputFingerprint) {
      throw new Error('ledger does not belong to this comparison input');
    }
  }

  classify(params: {
    divergenceId: string;
    kind: DecisionKind;
    reason: string;
    operator: string;
    clientTime?: string;
  }): DecisionLedger {
    this.ledger = classify(this.ledger, this.result, params);
    return this.ledger;
  }

  exempt(params: {
    divergenceId: string;
    reason: string;
    operator: string;
    rangeStart?: number;
    rangeEnd?: number;
    clientTime?: string;
  }): DecisionLedger {
    this.ledger = exempt(this.ledger, this.result, params);
    return this.ledger;
  }

  undo(params: {
    eventSeq: number;
    operator: string;
    reason: string;
    clientTime?: string;
  }): DecisionLedger {
    this.ledger = undo(this.ledger, this.result, params);
    return this.ledger;
  }

  batch(operations: BatchOperation[]): DecisionLedger {
    this.ledger = applyBatch(this.ledger, this.result, operations);
    return this.ledger;
  }

  projection(): DecisionProjection {
    return projectLedger(this.ledger, this.result);
  }

  exportPackage(request: CompareRequestInput, createdAt?: string): ExportPackage {
    return createExportPackage(request, this.result, this.ledger, {
      ...(createdAt ? { createdAt } : {}),
    });
  }

  verifyReplay(pkg: ExportPackage) {
    return verifyOfflineReplay(pkg);
  }
}
