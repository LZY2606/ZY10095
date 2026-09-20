import { describe, expect, it } from 'vitest';
import { ancestorContext, compareBuilds } from '../src/core/index.js';
import { remountRequest, sampleRequest } from './fixtures/sample.js';

describe('stable-evidence matching', () => {
  it('matches a remounted node across shadow/dom id changes via stable id', () => {
    const result = compareBuilds(remountRequest());
    const mapping = result.mappings[0]!;
    const match = mapping.matches.find((m) => m.baselineKey === 'confirm-btn');
    expect(match?.candidateKey).toBe('confirm-btn');
    expect(match?.evidence.stableId).toBe(true);
    expect(match?.evidence.confidence).toBe('high');
    expect(mapping.added).toEqual([]);
    expect(mapping.removed).toEqual([]);
  });

  it('matches a remounted node that moves across a shadow boundary', () => {
    const request = remountRequest();
    request.baseline.steps[0]!.dom.children![0]!.shadowHost = true;
    request.candidate.steps[0]!.dom.children![0]!.shadowHost = true;
    // Move the button out of the dialog in the candidate: CSS path changes
    // completely, stable evidence still identifies it.
    request.candidate.steps[0]!.dom.children!.push({
      tag: 'button',
      stableId: 'confirm-btn',
      id: 'new-id',
      text: '保存',
      focusable: true,
    });
    request.candidate.steps[0]!.dom.children![0]!.children = [];
    const result = compareBuilds(request);
    const match = result.mappings[0]!.matches.find(
      (m) => m.baselineKey === 'confirm-btn',
    );
    expect(match?.candidateKey).toBe('confirm-btn');
    expect(match?.evidence.confidence).not.toBe('low');
  });

  it('never pairs nodes whose explicit stable ids disagree', () => {
    const request = remountRequest();
    request.candidate.steps[0]!.dom = {
      tag: 'body',
      children: [
        {
          tag: 'div',
          stableId: 'settings-dialog',
          role: 'dialog',
          accessibleName: '设置',
          children: [
            {
              tag: 'button',
              stableId: 'a-different-id',
              id: 'new-id',
              text: '保存',
              focusable: true,
            },
          ],
        },
      ],
    };
    const result = compareBuilds(request);
    const mapping = result.mappings[0]!;
    expect(mapping.matches.some((m) => m.baselineKey === 'confirm-btn')).toBe(false);
    expect(mapping.removed).toContain('confirm-btn');
    expect(mapping.added).toContain('a-different-id');
  });

  it('falls back to semantic + ancestor evidence with lower confidence', () => {
    const request = remountRequest();
    // Remove explicit stable ids from both sides; keep role/name/ancestor.
    const strip = (dom: (typeof request.baseline.steps)[number]['dom']): void => {
      for (const child of dom.children ?? []) {
        if (child.role === 'dialog') {
          delete child.stableId;
          for (const button of child.children ?? []) {
            delete button.stableId;
            delete button.id;
          }
        }
      }
    };
    strip(request.baseline.steps[0]!.dom);
    strip(request.candidate.steps[0]!.dom);
    const result = compareBuilds(request);
    const match = result.mappings[0]!.matches.find(
      (m) => result.baseline.steps[0]!.byKey[m.baselineKey]?.role === 'button',
    );
    expect(match).toBeTruthy();
    expect(match!.evidence.stableId).toBe(false);
    expect(['low', 'medium']).toContain(match!.evidence.confidence);
  });

  it('computes ancestor context nearest-first across shadow boundaries', () => {
    const result = compareBuilds(sampleRequest());
    const baselineStep = result.baseline.steps[0]!;
    const field = baselineStep.byKey['name-field']!;
    const context = ancestorContext(field, baselineStep.byKey);
    expect(context[0]).toContain('dialog[设置]');
  });

  it('keeps the unmatched tooltip as added instead of force pairing', () => {
    const result = compareBuilds(sampleRequest());
    const step2 = result.mappings[2]!;
    expect(step2.added).toContain('hint-tooltip');
  });

  it('match output is identical on repeated independent runs', () => {
    const once = JSON.stringify(compareBuilds(sampleRequest()).mappings);
    const again = JSON.stringify(compareBuilds(sampleRequest()).mappings);
    expect(again).toBe(once);
  });
});
