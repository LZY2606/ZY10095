import { describe, expect, it } from 'vitest';
import { compareBuilds } from '../src/core/index.js';
import {
  BASELINE_FINGERPRINT,
  CANDIDATE_FINGERPRINT,
  sampleRequest,
} from './fixtures/sample.js';

describe('pair comparison', () => {
  const result = compareBuilds(sampleRequest());

  it('locates the earliest divergence at step 0', () => {
    expect(result.earliestStep).toBe(0);
  });

  it('detects every divergence kind on operable/semantic axes', () => {
    const kinds = [...new Set(result.divergences.map((d) => d.kind))].sort();
    expect(kinds).toEqual(
      [
        'finding',
        'focus-destination',
        'gone-node',
        'new-node',
        'reachable-set',
        'semantic-state',
      ].sort(),
    );
  });

  it('records focus destination evidence for both sides', () => {
    const focus = result.divergences.find(
      (d) => d.stepIndex === 0 && d.kind === 'focus-destination',
    )!;
    expect(focus.baseline.to).toBe('dialog-title');
    expect(focus.candidate.to).toBe('name-field');
  });

  it('records rule findings present on only one side with replayable evidence', () => {
    const codes = result.divergences
      .filter((d) => d.kind === 'finding')
      .map((d) => (d.candidate as { code?: string }).code ?? (d.baseline as { code?: string }).code);
    expect(codes.sort()).toEqual(
      ['focus-trap', 'live-repeat', 'unreachable-popup'].sort(),
    );
  });

  it('binds divergence fingerprints to both builds', () => {
    for (const divergence of result.divergences) {
      expect(divergence.baselineFingerprint).toBe(BASELINE_FINGERPRINT);
      expect(divergence.candidateFingerprint).toBe(CANDIDATE_FINGERPRINT);
    }
  });

  it('includes ancestor context on divergences', () => {
    const reachable = result.divergences.find(
      (d) => d.kind === 'reachable-set' && d.subjectKey === 'confirm-btn',
    )!;
    expect(reachable.ancestorContext.join(' ')).toContain('dialog');
  });

  it('returns no divergences for two identical builds', () => {
    const request = sampleRequest();
    const same = compareBuilds({
      baseline: request.baseline,
      candidate: JSON.parse(JSON.stringify(request.baseline)),
    });
    expect(same.divergences).toEqual([]);
    expect(same.earliestStep).toBeNull();
  });

  it('does not treat color-only changes as a divergence', () => {
    const request = sampleRequest();
    const recolor = JSON.parse(JSON.stringify(request.baseline)) as typeof request.baseline;
    recolor.steps[0]!.dom.children![0]!.states = { color: 'red' };
    const compared = compareBuilds({ baseline: request.baseline, candidate: recolor });
    expect(compared.divergences).toEqual([]);
  });
});
