import { describe, expect, it } from 'vitest';
import { detectFindings, replayBuild, type BuildInput } from '../src/core/index.js';

function singleStepBuild(dom: BuildInput['steps'][number]['dom'], extra: Partial<BuildInput['steps'][number]> = {}): BuildInput {
  return {
    side: 'baseline',
    fingerprint: 'f',
    steps: [
      {
        index: 0,
        action: { key: 'Tab' },
        dom,
        ...extra,
      },
    ],
  };
}

describe('focus trap detector', () => {
  it('flags a non-modal dialog whose focus never leaves', () => {
    const build = replayBuild(
      singleStepBuild(
        {
          tag: 'body',
          children: [
            { tag: 'button', stableId: 'outside', text: 'outside', focusable: true },
            {
              tag: 'div',
              stableId: 'dlg',
              role: 'dialog',
              accessibleName: '对话框',
              children: [
                { tag: 'button', stableId: 'inside', text: 'inside', focusable: true },
              ],
            },
          ],
        },
        { focus: { toRef: 'inside' } },
      ),
    );
    const findings = detectFindings(build);
    expect(findings.map((f) => f.code)).toEqual(['focus-trap']);
    expect(findings[0]!.evidence.variant).toBe('contained');
  });

  it('does not flag a modal dialog that legitimately confines focus', () => {
    const build = replayBuild(
      singleStepBuild({
        tag: 'body',
        children: [
          { tag: 'button', stableId: 'outside', text: 'outside', focusable: true },
          {
            tag: 'div',
            stableId: 'dlg',
            role: 'dialog',
            accessibleName: '模态',
            states: { modal: true },
            children: [
              { tag: 'button', stableId: 'inside', text: 'inside', focusable: true },
            ],
          },
        ],
      }),
    );
    expect(detectFindings(build)).toEqual([]);
  });

  it('flags a dead dialog with no focusable descendant', () => {
    const build = replayBuild(
      singleStepBuild({
        tag: 'body',
        children: [
          {
            tag: 'div',
            stableId: 'dlg',
            role: 'dialog',
            accessibleName: '空',
            states: { modal: true },
            children: [{ tag: 'p', text: '没有可聚焦元素' }],
          },
        ],
      }),
    );
    const findings = detectFindings(build);
    expect(findings[0]!.code).toBe('focus-trap');
    expect(findings[0]!.evidence.variant).toBe('dead');
  });
});

describe('unreachable popup detector', () => {
  it('flags a visible tooltip with no tab path and no focus entry', () => {
    const build = replayBuild(
      singleStepBuild({
        tag: 'body',
        children: [
          { tag: 'button', stableId: 'trigger', text: '?', focusable: true },
          {
            tag: 'div',
            stableId: 'tip',
            role: 'tooltip',
            text: '提示文字',
          },
        ],
      }),
    );
    const findings = detectFindings(build);
    expect(findings.map((f) => f.code)).toEqual(['unreachable-popup']);
  });

  it('does not flag a menu that receives focus', () => {
    const build = replayBuild(
      singleStepBuild(
        {
          tag: 'body',
          children: [
            {
              tag: 'div',
              stableId: 'menu',
              role: 'menu',
              accessibleName: '菜单',
              children: [
                { tag: 'div', stableId: 'item', role: 'menuitem', text: '一项', tabindex: 0 },
              ],
            },
          ],
        },
        { focus: { toRef: 'item' } },
      ),
    );
    expect(detectFindings(build)).toEqual([]);
  });
});

describe('live region repeat detector', () => {
  it('flags identical polite text repeated without a content change', () => {
    const build = replayBuild({
      side: 'baseline',
      fingerprint: 'f',
      steps: [1, 2, 3].map((index) => ({
        index: index - 1,
        action: { key: 'Tab' },
        dom: {
          tag: 'body',
          children: [
            { tag: 'div', stableId: 'live', live: 'polite' as const, text: '相同消息' },
          ],
        },
        announcements: [{ targetRef: 'live', polite: true, text: '相同消息' }],
      })),
    });
    const findings = detectFindings(build);
    expect(findings.map((f) => f.code)).toEqual(['live-repeat']);
    expect(findings[0]!.evidence.repeatedAtStep).toBeGreaterThan(0);
  });

  it('does not flag when the text actually changed', () => {
    const build = replayBuild({
      side: 'baseline',
      fingerprint: 'f',
      steps: ['一', '二'].map((text, index) => ({
        index,
        action: { key: 'Tab' },
        dom: {
          tag: 'body',
          children: [{ tag: 'div', stableId: 'live', live: 'polite' as const, text }],
        },
      })),
    });
    expect(detectFindings(build)).toEqual([]);
  });
});
