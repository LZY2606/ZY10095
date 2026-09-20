import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  classify,
  compareBuilds,
  createExportPackage,
  emptyLedger,
  verifyOfflineReplay,
} from '../src/core/index.js';
import { sampleRequest } from './fixtures/sample.js';

describe('export package', () => {
  it('contains raw request, mappings, findings, divergences and decisions', () => {
    const request = sampleRequest();
    const result = compareBuilds(request);
    const ledger = classify(emptyLedger(result), result, {
      divergenceId: result.divergences[0]!.id,
      kind: 'regression',
      reason: '需修复',
      operator: 'alice',
    });
    const pkg = createExportPackage(request, result, ledger);
    expect(pkg.format).toBe('pairwise-gsb-export');
    expect(pkg.request.baseline.fingerprint).toBe(result.baselineFingerprint);
    expect(pkg.result.mappings).toHaveLength(result.mappings.length);
    expect(pkg.result.divergences).toHaveLength(result.divergences.length);
    expect(pkg.ledger.events).toHaveLength(1);
    expect(pkg.result.replayOrder.baseline.length).toBe(result.baseline.steps.length);
  });

  it('offline replay reproduces replay order and divergences exactly', () => {
    const request = sampleRequest();
    const result = compareBuilds(request);
    const pkg = createExportPackage(request, result, emptyLedger(result));
    const verification = verifyOfflineReplay(pkg);
    expect(verification.ok).toBe(true);
    expect(verification.details).toEqual({
      baselineOrderMatches: true,
      candidateOrderMatches: true,
      divergencesMatch: true,
    });
  });

  it('detects tampered replay order in an exported package', () => {
    const request = sampleRequest();
    const result = compareBuilds(request);
    const pkg = createExportPackage(request, result, emptyLedger(result));
    pkg.result.replayOrder.baseline[0]!.reverse();
    const verification = verifyOfflineReplay(pkg);
    expect(verification.ok).toBe(false);
    expect(verification.details.baselineOrderMatches).toBe(false);
  });
});

describe('determinism', () => {
  it('produces byte-identical results across runs independent of traversal', () => {
    const first = canonicalJson(compareBuilds(sampleRequest()));
    const second = canonicalJson(compareBuilds(sampleRequest()));
    expect(second).toBe(first);
  });

  it('ignores key insertion order in the input', () => {
    const reordered = sampleRequest();
    const first = canonicalJson(compareBuilds(reordered));
    const shuffled = JSON.parse(JSON.stringify(reordered)) as typeof reordered;
    // Move a step object key order around (JSON round-trip + property re-add).
    for (const side of [shuffled.baseline, shuffled.candidate]) {
      for (const step of side.steps) {
        const action = step.action;
        const keys = Object.keys(action).reverse();
        const rebuilt: Record<string, string | number | boolean> = {};
        for (const key of keys) {
          rebuilt[key] = action[key]!;
        }
        step.action = rebuilt;
      }
    }
    expect(canonicalJson(compareBuilds(shuffled))).toBe(first);
  });

  it('never depends on current time: no clientTime means no timestamp stored', () => {
    const request = sampleRequest();
    const result = compareBuilds(request);
    const ledger = classify(emptyLedger(result), result, {
      divergenceId: result.divergences[0]!.id,
      kind: 'intentional',
      reason: 'r',
      operator: 'alice',
    });
    expect(ledger.events[0]!.clientTime).toBeUndefined();
    const pkg = createExportPackage(request, result, ledger);
    expect(pkg.createdAt).toBeNull();
  });

  it('uses the declared rule version on every result', () => {
    const result = compareBuilds(sampleRequest());
    expect(result.ruleVersion).toMatch(/^rules-\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('refuses to compute with a declared mismatched rule version', () => {
    const request = sampleRequest();
    request.ruleVersion = 'rules-1999-01-01.0';
    expect(() => compareBuilds(request)).toThrow('rule version mismatch');
  });

  it('exported package carries a replay order deterministically independent of current time', () => {
    const request = sampleRequest();
    const result = compareBuilds(request);
    const pkg = createExportPackage(request, result, emptyLedger(result));
    const first = canonicalJson(pkg.result.replayOrder);
    const again = canonicalJson(
      createExportPackage(sampleRequest(), compareBuilds(sampleRequest()), emptyLedger(compareBuilds(sampleRequest()))).result.replayOrder,
    );
    expect(again).toBe(first);
  });
});
