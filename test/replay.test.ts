import { describe, expect, it } from 'vitest';
import {
  assertSameActionSequence,
  replayBuild,
} from '../src/core/index.js';
import { sampleRequest } from './fixtures/sample.js';

const request = sampleRequest();

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected error ${code}`);
}

describe('replay engine', () => {
  it('flattens shadow hosts into one tab order', () => {
    const baseline = replayBuild(request.baseline);
    const first = baseline.steps[0]!;
    expect(first.tabOrder).toEqual([
      'open-btn',
      'dialog-title',
      'name-field',
      'confirm-btn',
      'reset-btn',
    ]);
  });

  it('computes tabindex ordering by explicit index then preorder', () => {
    const build = replayBuild({
      side: 'baseline',
      fingerprint: 'f',
      steps: [
        {
          index: 0,
          action: { key: 'Tab' },
          dom: {
            tag: 'body',
            children: [
              { tag: 'button', stableId: 'a', text: 'a', focusable: true, tabindex: 0 },
              { tag: 'button', stableId: 'b', text: 'b', focusable: true, tabindex: 2 },
              { tag: 'button', stableId: 'c', text: 'c', focusable: true, tabindex: 1 },
              { tag: 'button', stableId: 'd', text: 'd', focusable: true, tabindex: 0 },
            ],
          },
        },
      ],
    });
    expect(build.steps[0]!.tabOrder).toEqual(['c', 'b', 'a', 'd']);
  });

  it('resolves accessible names from aria-labelledby references', () => {
    const baseline = replayBuild(request.baseline);
    const field = baseline.steps[0]!.byKey['name-field']!;
    expect(field.name).toBe('名称');
  });

  it('excludes hidden and aria-hidden subtrees from reachable nodes', () => {
    const build = replayBuild({
      side: 'baseline',
      fingerprint: 'f',
      steps: [
        {
          index: 0,
          action: { key: 'Tab' },
          dom: {
            tag: 'body',
            children: [
              { tag: 'button', stableId: 'visible', text: 'v', focusable: true },
              {
                tag: 'div',
                ariaHidden: true,
                children: [
                  { tag: 'button', stableId: 'hidden-btn', text: 'h', focusable: true },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(build.steps[0]!.tabOrder).toEqual(['visible']);
  });

  it('derives polite announcements only when live text changes', () => {
    const baseline = replayBuild(request.baseline);
    expect(baseline.steps[2]!.announcements.map((a) => a.text)).toEqual(['正在保存']);
    expect(baseline.steps[3]!.announcements.map((a) => a.text)).toEqual(['已保存']);
  });

  it('rejects non-dense step indices', () => {
    expectCode(
      () =>
        replayBuild({
          side: 'baseline',
          fingerprint: 'f',
          steps: [
            { index: 0, action: { key: 'Tab' }, dom: { tag: 'body' } },
            { index: 2, action: { key: 'Tab' }, dom: { tag: 'body' } },
          ],
        }),
      'DENSE_STEPS',
    );
  });

  it('rejects builds applying different keyboard sequences', () => {
    const baseline = replayBuild(request.baseline);
    const mutated = replayBuild({
      ...request.candidate,
      steps: request.candidate.steps.map((step, i) =>
        i === 1 ? { ...step, action: { key: 'Shift+Tab' } } : step,
      ),
    });
    expectCode(
      () => assertSameActionSequence(baseline, mutated),
      'ACTION_MISMATCH',
    );
  });

  it('rejects focus events referencing unknown nodes', () => {
    expectCode(
      () =>
        replayBuild({
          side: 'baseline',
          fingerprint: 'f',
          steps: [
            {
              index: 0,
              action: { key: 'Tab' },
              focus: { toRef: 'ghost' },
              dom: { tag: 'body' },
            },
          ],
        }),
      'DANGLING_REF',
    );
  });
});
