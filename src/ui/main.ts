import './styles.css';
import {
  classify,
  createExportPackage,
  exempt,
  projectLedger,
  undo,
  verifyOfflineReplay,
  type CompareRequestInput,
  type DecisionLedger,
} from '../core/index.js';
import { canonicalJson } from '../core/deterministic.js';
import {
  clearSession,
  loadSampleRequest,
  persist,
  restoreSession,
  runComparison,
  state,
} from './state.js';
import {
  divergenceTitle,
  el,
  kindLabel,
  renderEvidenceBlock,
  renderMatchTable,
  renderNodeTree,
  renderStepTimeline,
  statusBadge,
} from './view.js';
import { renderDivergenceList } from './view-extra.js';

const root = document.querySelector('#app')!;

function render(): void {
  root.textContent = '';
  root.append(renderHeader());
  if (!state.workbench || !state.request) {
    root.append(renderLanding());
    return;
  }
  root.append(renderWorkbench());
}

function renderHeader(): HTMLElement {
  const header = el('header');
  header.append(
    el('h1', {}, 'Pair-wise GSB · 键盘与辅助技术语义比对工作台'),
    el(
      'div',
      { class: 'sub mono' },
      '颜色变化不作为结论 · 仅比对可操作路径与语义状态 · 所有输出由保存的输入与规则版本确定性重放得到',
    ),
  );
  return header;
}

function renderLanding(): HTMLElement {
  const panel = el('div', { class: 'panel' });
  panel.style.maxWidth = '760px';
  panel.style.margin = '24px auto';
  panel.append(el('h2', {}, '导入比对输入'));
  panel.append(
    el('p', { class: 'muted' }, '上传一份包含 baseline / candidate 的 JSON（DOM 快照、可访问树、焦点事件、键盘序列）。'),
  );

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json' }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text) as CompareRequestInput;
        runComparison(parsed);
        render();
      })
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      });
  });
  panel.append(el('label', { class: 'field' }, el('span', {}, '比对请求 JSON'), fileInput));

  const row = el('div', { class: 'row' });
  const sample = el('button', { class: 'primary' }, '载入内置演示会话');
  sample.addEventListener('click', () => {
    runComparison(loadSampleRequest());
    render();
  });
  row.append(sample);
  panel.append(row);

  if (state.error) {
    panel.append(el('div', { class: 'error' }, state.error));
  }
  return panel;
}

function renderWorkbench(): HTMLElement {
  const layout = el('div', { class: 'layout' });
  layout.append(renderLeftColumn(), renderRightColumn());
  return layout;
}

function renderLeftColumn(): HTMLElement {
  const column = el('div');
  const result = state.workbench!.result;

  const meta = el('div', { class: 'panel' });
  meta.append(el('h2', {}, '构建指纹'));
  meta.append(
    el('div', { class: 'mono' }, `基线: ${result.baselineFingerprint}`),
    el('div', { class: 'mono' }, `候选: ${result.candidateFingerprint}`),
    el('div', { class: 'mono muted' }, `规则版本: ${result.ruleVersion}`),
    el('div', { class: 'mono muted' }, `输入指纹: ${result.inputFingerprint.slice(0, 16)}…`),
  );
  column.append(meta);

  const steps = el('div', { class: 'panel' });
  steps.append(
    el('h2', {}, `操作序列（最早分歧：${result.earliestStep ?? '无'}）`),
    renderStepTimeline(result, state.selectedStep, (index) => {
      state.selectedStep = index;
      const first = result.divergences.find((d) => d.stepIndex === index);
      state.selectedDivergence = first?.id ?? null;
      render();
    }),
  );
  column.append(steps);

  const list = el('div', { class: 'panel' });
  list.append(el('h2', {}, '分歧列表'));
  const projection = projectLedger(state.workbench!.ledger, result);
  list.append(
    renderDivergenceList(
      result,
      projection,
      state.selectedDivergence,
      (id) => {
        state.selectedDivergence = id;
        const divergence = result.divergences.find((entry) => entry.id === id);
        if (divergence) {
          state.selectedStep = divergence.stepIndex;
        }
        render();
      },
    ),
  );
  column.append(list);

  column.append(renderActionsPanel());
  return column;
}

function renderActionsPanel(): HTMLElement {
  const panel = el('div', { class: 'panel' });
  panel.append(el('h2', {}, '会话'));
  const operator = el('input', { placeholder: '操作者' }) as HTMLInputElement;
  operator.value = state.operator;
  operator.addEventListener('input', () => {
    state.operator = operator.value || 'reviewer';
    persist();
  });
  panel.append(el('label', { class: 'field' }, el('span', {}, '当前操作者'), operator));

  const row = el('div', { class: 'row' });
  const exportButton = el('button', { class: 'primary' }, '导出离线包');
  exportButton.addEventListener('click', downloadExport);
  const verifyButton = el('button', {}, '校验当前离线重放');
  verifyButton.addEventListener('click', () => {
    const pkg = createExportPackage(state.request!, state.workbench!.result, state.workbench!.ledger);
    const verification = verifyOfflineReplay(pkg);
    state.error = verification.ok
      ? null
      : `离线重放不一致：${JSON.stringify(verification.details)}`;
    window.alert(
      verification.ok
        ? '离线重放校验通过：顺序与分歧完全一致'
        : `离线重放不一致：${JSON.stringify(verification.details)}`,
    );
  });
  const reset = el('button', { class: 'danger' }, '清除会话');
  reset.addEventListener('click', () => {
    clearSession();
    render();
  });
  row.append(exportButton, verifyButton, reset);
  panel.append(row);
  return panel;
}

function downloadExport(): void {
  const wb = state.workbench!;
  const pkg = createExportPackage(state.request!, wb.result, wb.ledger);
  const blob = new Blob([canonicalJson(pkg)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pairwise-gsb-${pkg.inputFingerprint.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderRightColumn(): HTMLElement {
  const result = state.workbench!.result;
  const column = el('div');
  const baselineStep = result.baseline.steps[state.selectedStep]!;
  const candidateStep = result.candidate.steps[state.selectedStep]!;

  const trees = el('div', { class: 'panel split' });
  trees.append(
    renderNodeTree(baselineStep, '基线重建'),
    renderNodeTree(candidateStep, '候选重建'),
  );
  column.append(trees);

  const mappingPanel = el('div', { class: 'panel' });
  mappingPanel.append(el('h2', {}, '稳定证据匹配'));
  mappingPanel.append(
    renderMatchTable(result.mappings[state.selectedStep]!, baselineStep, candidateStep),
  );
  column.append(mappingPanel);

  const divergence = result.divergences.find(
    (entry) => entry.id === state.selectedDivergence,
  );
  if (divergence) {
    column.append(renderDivergenceDetail(divergence.id));
  }
  column.append(renderEventHistory());
  return column;
}

function renderDivergenceDetail(divergenceId: string): HTMLElement {
  const wb = state.workbench!;
  const divergence = wb.result.divergences.find((entry) => entry.id === divergenceId)!;
  const projection = projectLedger(wb.ledger, wb.result);
  const panel = el('div', { class: 'panel' });
  const head = el('div', { class: 'row' });
  head.append(
    el('span', { class: `kind ${divergence.kind}` }, kindLabel(divergence.kind)),
    el('strong', {}, divergenceTitle(divergence)),
    statusBadge(divergence.id, projection),
  );
  panel.append(el('h2', {}, '分歧详情'), head, renderEvidenceBlock(divergence));
  if (divergence.ancestorContext.length > 0) {
    panel.append(
      el('p', { class: 'muted mono' }, `祖先上下文: ${divergence.ancestorContext.join(' > ')}`),
    );
  }
  panel.append(renderDecisionForm(divergence.id));
  return panel;
}

function renderDecisionForm(divergenceId: string): HTMLElement {
  const wrap = el('div');
  const reason = el('textarea', { rows: '2', placeholder: '决定理由（必填）' }) as HTMLTextAreaElement;
  wrap.append(el('label', { class: 'field' }, el('span', {}, '理由'), reason));

  const rangeRow = el('div', { class: 'row' });
  const result = state.workbench!.result;
  const total = result.baseline.steps.length;
  const rangeStart = el('select') as HTMLSelectElement;
  const rangeEnd = el('select') as HTMLSelectElement;
  for (let i = 0; i < total; i++) {
    rangeStart.append(el('option', { value: String(i) }, `第${i}步`));
    rangeEnd.append(el('option', { value: String(i) }, `第${i}步`));
  }
  rangeEnd.value = String(total - 1);
  rangeRow.append(el('span', { class: 'muted' }, '豁免范围'), rangeStart, el('span', {}, '→'), rangeEnd);

  const buttons = el('div', { class: 'row' });
  const intentional = el('button', {}, '标记为有意');
  intentional.addEventListener('click', () =>
    commit((ledger) =>
      classify(ledger, result, {
        divergenceId,
        kind: 'intentional',
        reason: reason.value,
        operator: state.operator,
      }),
    ),
  );
  const regression = el('button', {}, '标记为回归');
  regression.addEventListener('click', () =>
    commit((ledger) =>
      classify(ledger, result, {
        divergenceId,
        kind: 'regression',
        reason: reason.value,
        operator: state.operator,
      }),
    ),
  );
  const exemptButton = el('button', { class: 'primary' }, '声明有意并生成豁免');
  exemptButton.addEventListener('click', () =>
    commit((ledger) =>
      exempt(ledger, result, {
        divergenceId,
        reason: reason.value,
        operator: state.operator,
        rangeStart: Number(rangeStart.value),
        rangeEnd: Number(rangeEnd.value),
      }),
    ),
  );
  buttons.append(intentional, regression, exemptButton);
  wrap.append(rangeRow, buttons);
  return wrap;
}

function commit(mutator: (ledger: DecisionLedger) => DecisionLedger): void {
  const wb = state.workbench!;
  try {
    wb.ledger = mutator(wb.ledger);
    persist();
    state.error = null;
    render();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

function renderEventHistory(): HTMLElement {
  const panel = el('div', { class: 'panel' });
  panel.append(el('h2', {}, '决定事件历史（追加，不删除）'));
  const ledger = state.workbench!.ledger;
  if (ledger.events.length === 0) {
    panel.append(el('p', { class: 'muted' }, '尚无人工决定。'));
    return panel;
  }
  const undone = new Set(
    ledger.events.filter((event) => event.type === 'undone').map((event) => event.undoesSeq!),
  );
  for (const event of ledger.events) {
    const row = el('div', {
      class: `event ${event.type === 'undone' || undone.has(event.seq) ? 'undone' : ''}`,
    });
    row.append(
      el(
        'div',
        {},
        `#${event.seq} ${event.type} · ${event.operator} · 分歧 ${event.divergenceId.slice(0, 8)}`,
      ),
      el('div', { class: 'muted' }, event.reason),
      el('div', { class: 'mono muted' }, `版本 ${event.beforeVersion?.slice(0, 8) ?? '∅'} → ${event.afterVersion.slice(0, 8)}`),
    );
    if (event.type !== 'undone' && !undone.has(event.seq)) {
      const undoButton = el('button', { class: 'danger' }, '撤销（本人）');
      undoButton.addEventListener('click', () => {
        const reason = window.prompt('撤销理由（必填）');
        if (reason === null) {
          return;
        }
        try {
          state.workbench!.ledger = undo(state.workbench!.ledger, state.workbench!.result, {
            eventSeq: event.seq,
            operator: state.operator,
            reason,
          });
          persist();
          render();
        } catch (error) {
          state.error = error instanceof Error ? error.message : String(error);
          render();
        }
      });
      row.append(undoButton);
    }
    panel.append(row);
  }
  return panel;
}

if (restoreSession()) {
  state.selectedStep = state.workbench!.result.earliestStep ?? 0;
}
render();
