import { describe, expect, it } from 'vitest';
import {
  applyBatch,
  classify,
  compareBuilds,
  emptyLedger,
  exempt,
  projectLedger,
  undo,
} from '../src/core/index.js';
import { sampleRequest } from './fixtures/sample.js';

function setup() {
  const result = compareBuilds(sampleRequest());
  return { result, ledger: emptyLedger(result) };
}

describe('classification ledger', () => {
  it('returns conflict instead of overwriting a different classification', () => {
    const { result, ledger } = setup();
    const id = result.divergences[0]!.id;
    const once = classify(ledger, result, {
      divergenceId: id,
      kind: 'regression',
      reason: '焦点错位',
      operator: 'alice',
    });
    const twice = classify(once, result, {
      divergenceId: id,
      kind: 'intentional',
      reason: '自动聚焦策略调整',
      operator: 'bob',
    });
    const projection = projectLedger(twice, result);
    const view = projection.views[id]!;
    expect(view.conflict).toBe(true);
    expect(view.status).toBe('conflict');
    expect(view.classifications.map((c) => c.operator)).toEqual(['alice', 'bob']);
  });

  it('records reason, operator and before/after versions on every event', () => {
    const { result, ledger } = setup();
    const updated = classify(ledger, result, {
      divergenceId: result.divergences[0]!.id,
      kind: 'regression',
      reason: 'r',
      operator: 'alice',
    });
    const event = updated.events[0]!;
    expect(event.beforeVersion).toBeNull();
    expect(event.afterVersion).toBe(updated.version);
    expect(event.reason).toBe('r');
    expect(event.operator).toBe('alice');
  });

  it('undo appends a new event and never deletes history', () => {
    const { result, ledger } = setup();
    const id = result.divergences[0]!.id;
    const classified = classify(ledger, result, {
      divergenceId: id,
      kind: 'regression',
      reason: 'r',
      operator: 'alice',
    });
    const undone = undo(classified, result, {
      eventSeq: 0,
      operator: 'alice',
      reason: '误报',
    });
    expect(undone.events).toHaveLength(2);
    expect(undone.events[0]!.type).toBe('classified');
    expect(undone.events[1]!).toMatchObject({
      type: 'undone',
      undoesSeq: 0,
      reason: '误报',
    });
    expect(projectLedger(undone, result).views[id]!.status).toBe('unclassified');
  });

  it('forbids undoing another operator decision', () => {
    const { result, ledger } = setup();
    const classified = classify(ledger, result, {
      divergenceId: result.divergences[0]!.id,
      kind: 'regression',
      reason: 'r',
      operator: 'alice',
    });
    expect(() =>
      undo(classified, result, {
        eventSeq: 0,
        operator: 'bob',
        reason: '不同意',
      }),
    ).toThrow('only the original operator');
  });
});

describe('exemptions', () => {
  it('binds role, name, ancestor context and both build fingerprints', () => {
    const { result, ledger } = setup();
    const divergence = result.divergences.find((d) => d.kind === 'reachable-set')!;
    const updated = exempt(ledger, result, {
      divergenceId: divergence.id,
      reason: '保存入口改为快捷键',
      operator: 'carol',
    });
    const event = updated.events[0]!;
    expect(event.binding).toMatchObject({
      role: 'button',
      accessibleName: '保存',
      baselineFingerprint: result.baselineFingerprint,
      candidateFingerprint: result.candidateFingerprint,
      ruleVersion: result.ruleVersion,
    });
    expect(event.binding!.ancestorContext.join(' ')).toContain('dialog');
    expect(projectLedger(updated, result).exemptions[0]!.status).toBe('active');
  });

  it('accepts an explicit inclusive step range', () => {
    const { result, ledger } = setup();
    const divergence = result.divergences[0]!;
    const updated = exempt(ledger, result, {
      divergenceId: divergence.id,
      reason: '仅本次发布',
      operator: 'carol',
      rangeStart: 0,
      rangeEnd: 1,
    });
    const view = projectLedger(updated, result).exemptions[0]!;
    expect(view.rangeStart).toBe(0);
    expect(view.rangeEnd).toBe(1);
  });

  it('invalidates automatically when the node moves (ancestor change)', () => {
    const { result, ledger } = setup();
    const divergence = result.divergences.find((d) => d.kind === 'reachable-set')!;
    const updated = exempt(ledger, result, {
      divergenceId: divergence.id,
      reason: '已知调整',
      operator: 'carol',
    });

    const mutated = JSON.parse(JSON.stringify(sampleRequest())) as ReturnType<typeof sampleRequest>;
    // Move the save button under a differently named dialog in the candidate.
    for (const step of mutated.candidate.steps) {
      const dialog = step.dom.children?.find((c) => c.stableId === 'settings-dialog');
      if (dialog) {
        dialog.accessibleName = '高级设置';
      }
    }
    const reCompared = compareBuilds(mutated);
    const reProjection = projectLedger(updated, reCompared);
    const exemption = reProjection.exemptions[0]!;
    expect(exemption.status).toBe('invalid');
    expect(['node-moved', 'name-changed']).toContain(exemption.invalidReason);
  });

  it('invalidates automatically when the build fingerprint changes', () => {
    const { result, ledger } = setup();
    const updated = exempt(ledger, result, {
      divergenceId: result.divergences[0]!.id,
      reason: 'r',
      operator: 'carol',
    });
    const mutated = JSON.parse(JSON.stringify(sampleRequest())) as ReturnType<typeof sampleRequest>;
    mutated.candidate.fingerprint = 'candidate-xyz789';
    const reCompared = compareBuilds(mutated);
    expect(projectLedger(updated, reCompared).exemptions[0]!).toMatchObject({
      status: 'invalid',
      invalidReason: 'fingerprint-changed',
    });
  });

  it('invalidates when the accessible name changes', () => {
    const { result, ledger } = setup();
    const divergence = result.divergences.find((d) => d.kind === 'reachable-set')!;
    const updated = exempt(ledger, result, {
      divergenceId: divergence.id,
      reason: 'r',
      operator: 'carol',
    });
    const mutated = JSON.parse(JSON.stringify(sampleRequest())) as ReturnType<typeof sampleRequest>;
    for (const step of mutated.candidate.steps) {
      const walk = (node: (typeof step.dom) | undefined): void => {
        if (!node) return;
        if (node.stableId === 'confirm-btn') {
          node.text = '应用';
        }
        node.children?.forEach(walk);
      };
      walk(step.dom);
    }
    const reCompared = compareBuilds(mutated);
    expect(projectLedger(updated, reCompared).exemptions[0]!).toMatchObject({
      status: 'invalid',
      invalidReason: 'name-changed',
    });
  });
});

describe('transactional batches', () => {
  it('leaves no partial result when one operation is invalid', () => {
    const { result, ledger } = setup();
    const snapshot = JSON.stringify(ledger);
    expect(() =>
      applyBatch(ledger, result, [
        {
          divergenceId: result.divergences[0]!.id,
          type: 'classified',
          kind: 'regression',
          reason: 'ok',
          operator: 'alice',
        },
        {
          divergenceId: 'does-not-exist',
          type: 'classified',
          kind: 'intentional',
          reason: 'bad',
          operator: 'alice',
        },
      ]),
    ).toThrow('unknown divergence');
    expect(JSON.stringify(ledger)).toBe(snapshot);
    const projection = projectLedger(ledger, result);
    expect(
      Object.values(projection.views).every(
        (view) => view.classifications.length === 0 && view.activeExemptions.length === 0,
      ),
    ).toBe(true);
  });

  it('commits all events only when the whole batch succeeds', () => {
    const { result, ledger } = setup();
    const updated = applyBatch(ledger, result, [
      {
        divergenceId: result.divergences[0]!.id,
        type: 'classified',
        kind: 'regression',
        reason: 'a',
        operator: 'alice',
      },
      {
        divergenceId: result.divergences[1]!.id,
        type: 'exempted',
        reason: 'b',
        operator: 'alice',
      },
    ]);
    expect(updated.events).toHaveLength(2);
  });

  it('undoing an exemption removes it from the active set via an append event', () => {
    const { result, ledger } = setup();
    const id = result.divergences[0]!.id;
    const exempted = exempt(ledger, result, {
      divergenceId: id,
      reason: '临时豁免',
      operator: 'dave',
    });
    expect(projectLedger(exempted, result).exemptions).toHaveLength(1);
    const undone = undo(exempted, result, {
      eventSeq: 0,
      operator: 'dave',
      reason: '重新评估',
    });
    const projection = projectLedger(undone, result);
    expect(projection.exemptions).toHaveLength(0);
    expect(undone.events).toHaveLength(2);
    expect(undone.events[1]!.type).toBe('undone');
  });

  it('versions form a hash chain across events', () => {
    const { result, ledger } = setup();
    const once = classify(ledger, result, {
      divergenceId: result.divergences[0]!.id,
      kind: 'regression',
      reason: 'a',
      operator: 'alice',
    });
    const twice = classify(once, result, {
      divergenceId: result.divergences[1]!.id,
      kind: 'intentional',
      reason: 'b',
      operator: 'alice',
    });
    expect(twice.events[1]!.beforeVersion).toBe(once.version);
    expect(twice.version).toBe(twice.events[1]!.afterVersion);
  });
});
