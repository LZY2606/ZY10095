/**
 * Shared fixture: a small recorded keyboard session imported from two builds.
 *
 * The baseline opens an accessible modal dialog. The candidate regresses in
 * several ways so the demo exercises every divergence kind:
 *  - step 1: focus skips the dialog's first control (focus destination)
 *  - step 2: the confirm button is dropped from the tab order (reachable set)
 *  - a decorative remount changes DOM id/CSS path but keeps stable evidence
 *  - a live region repeats the same announcement with no content change
 *  - an unreachable tooltip popup exists only in the candidate
 */

import type { CompareRequestInput, BuildInput } from './types.js';

export const BASELINE_FINGERPRINT = 'baseline-abc123';
export const CANDIDATE_FINGERPRINT = 'candidate-def456';

const actionTab = { key: 'Tab' };

function baselineBuild(): BuildInput {
  return {
    side: 'baseline',
    fingerprint: BASELINE_FINGERPRINT,
    label: '基线构建 abc123',
    steps: [
      {
        index: 0,
        action: { key: 'Enter' },
        focus: { fromRef: 'open-btn', toRef: 'dialog-title', reason: 'autofocus' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              states: { modal: true },
              shadowHost: true,
              children: [
                {
                  tag: 'h2',
                  stableId: 'dialog-title',
                  text: '设置',
                  tabindex: 0,
                  states: { level: '2' },
                },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  labelledby: ['name-label'],
                  states: { required: true },
                },
                {
                  tag: 'label',
                  stableId: 'name-label',
                  text: '名称',
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  text: '保存',
                  focusable: true,
                },
                {
                  tag: 'button',
                  stableId: 'reset-btn',
                  text: '恢复默认',
                  focusable: true,
                },
              ],
            },
          ],
        },
      },
      {
        index: 1,
        action: actionTab,
        focus: { fromRef: 'dialog-title', toRef: 'name-field', reason: 'Tab' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              states: { modal: true },
              shadowHost: true,
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true },
                },
                {
                  tag: 'label',
                  stableId: 'name-label',
                  text: '名称',
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  text: '保存',
                  focusable: true,
                },
                {
                  tag: 'button',
                  stableId: 'reset-btn',
                  text: '恢复默认',
                  focusable: true,
                },
              ],
            },
          ],
        },
      },
      {
        index: 2,
        action: actionTab,
        focus: { fromRef: 'name-field', toRef: 'confirm-btn', reason: 'Tab' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              states: { modal: true },
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true, value: '李雷' },
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  text: '保存',
                  focusable: true,
                },
                {
                  tag: 'button',
                  stableId: 'reset-btn',
                  text: '恢复默认',
                  focusable: true,
                },
                {
                  tag: 'div',
                  stableId: 'status-msg',
                  live: 'polite',
                  text: '正在保存',
                },
              ],
            },
          ],
        },
        announcements: [
          { targetRef: 'status-msg', polite: true, text: '正在保存' },
        ],
      },
      {
        index: 3,
        action: actionTab,
        focus: { fromRef: 'confirm-btn', toRef: 'confirm-btn', reason: 'Tab-cycle' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              states: { modal: true },
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true, value: '李雷' },
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  text: '保存',
                  focusable: true,
                },
                {
                  tag: 'button',
                  stableId: 'reset-btn',
                  text: '恢复默认',
                  focusable: true,
                },
                {
                  tag: 'div',
                  stableId: 'status-msg',
                  live: 'polite',
                  text: '已保存',
                },
              ],
            },
          ],
        },
        announcements: [
          { targetRef: 'status-msg', polite: true, text: '已保存' },
        ],
      },
    ],
  };
}

function candidateBuild(): BuildInput {
  return {
    side: 'candidate',
    fingerprint: CANDIDATE_FINGERPRINT,
    label: '候选构建 def456',
    steps: [
      {
        index: 0,
        action: { key: 'Enter' },
        // Regression: autofocus skips the dialog heading and lands in the field.
        focus: { fromRef: 'open-btn', toRef: 'name-field', reason: 'autofocus' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              // Remounted: new DOM id, different CSS path, same stable evidence.
              id: 'btn-v2-9f3',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              shadowHost: true,
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true },
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  text: '保存',
                  focusable: true,
                },
              ],
            },
          ],
        },
      },
      {
        index: 1,
        action: actionTab,
        focus: { fromRef: 'name-field', toRef: 'confirm-btn', reason: 'Tab' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              id: 'btn-v2-9f3',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              shadowHost: true,
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true },
                },
                // Remounted under a wrapper: CSS path changed, stable id kept.
                {
                  tag: 'div',
                  stableId: 'action-wrapper',
                  children: [
                    {
                      tag: 'button',
                      stableId: 'confirm-btn',
                      id: 'save-button',
                      text: '保存',
                      focusable: true,
                    },
                  ],
                },
                // A genuinely new operable node with no baseline counterpart.
                {
                  tag: 'a',
                  stableId: 'shortcuts-link',
                  text: '查看键盘快捷键',
                  focusable: true,
                },
              ],
            },
          ],
        },
      },
      {
        index: 2,
        action: actionTab,
        // Regression: the save button dropped out of the tab order; focus cycles.
        focus: { fromRef: 'name-field', toRef: 'name-field', reason: 'Tab-cycle' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              id: 'btn-v2-9f3',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true, value: '李雷' },
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  id: 'save-button',
                  text: '保存',
                  tabindex: -1,
                },
                // Visible tooltip popup with no keyboard path and no focus.
                {
                  tag: 'div',
                  stableId: 'hint-tooltip',
                  role: 'tooltip',
                  text: '使用 Tab 在字段间移动',
                },
                {
                  tag: 'div',
                  stableId: 'status-msg',
                  live: 'polite',
                  text: '正在保存',
                },
              ],
            },
          ],
        },
        announcements: [
          { targetRef: 'status-msg', polite: true, text: '正在保存' },
        ],
      },
      {
        index: 3,
        action: actionTab,
        focus: { fromRef: 'name-field', toRef: 'name-field', reason: 'Tab-cycle' },
        dom: {
          tag: 'body',
          children: [
            {
              tag: 'button',
              stableId: 'open-btn',
              id: 'btn-v2-9f3',
              text: '打开设置',
              focusable: true,
            },
            {
              tag: 'div',
              stableId: 'settings-dialog',
              role: 'dialog',
              accessibleName: '设置',
              children: [
                { tag: 'h2', stableId: 'dialog-title', text: '设置', tabindex: 0, states: { level: '2' } },
                {
                  tag: 'input',
                  stableId: 'name-field',
                  role: 'textbox',
                  accessibleName: '名称',
                  states: { required: true, value: '李雷' },
                },
                {
                  tag: 'button',
                  stableId: 'confirm-btn',
                  id: 'save-button',
                  text: '保存',
                  tabindex: -1,
                },
                {
                  tag: 'div',
                  stableId: 'hint-tooltip',
                  role: 'tooltip',
                  text: '使用 Tab 在字段间移动',
                },
                {
                  tag: 'div',
                  stableId: 'status-msg',
                  live: 'polite',
                  text: '正在保存',
                },
              ],
            },
          ],
        },
        announcements: [
          { targetRef: 'status-msg', polite: true, text: '正在保存' },
        ],
      },
    ],
  };
}

export function sampleRequest(): CompareRequestInput {
  return {
    baseline: baselineBuild(),
    candidate: candidateBuild(),
  };
}

/**
 * Tiny remount-only pair: node changes DOM id and position but keeps the
 * stable id, role and name. Used by the matching tests.
 */
export function remountRequest(): CompareRequestInput {
  const dialog = (saveChild: BuildInput['steps'][number]['dom']): BuildInput['steps'][number]['dom'] => ({
    tag: 'body',
    children: [
      {
        tag: 'div',
        stableId: 'settings-dialog',
        role: 'dialog',
        accessibleName: '设置',
        children: [saveChild],
      },
    ],
  });
  return {
    baseline: {
      side: 'baseline',
      fingerprint: BASELINE_FINGERPRINT,
      steps: [
        {
          index: 0,
          action: { key: 'Tab' },
          dom: dialog({
            tag: 'button',
            stableId: 'confirm-btn',
            id: 'old-id',
            text: '保存',
            focusable: true,
          }),
        },
      ],
    },
    candidate: {
      side: 'candidate',
      fingerprint: CANDIDATE_FINGERPRINT,
      steps: [
        {
          index: 0,
          action: { key: 'Tab' },
          dom: dialog({
            tag: 'button',
            stableId: 'confirm-btn',
            id: 'new-id',
            text: '保存',
            focusable: true,
          }),
        },
      ],
    },
  };
}
