import type {
  ComparisonResult,
  DecisionProjection,
} from '../core/index.js';
import { divergenceTitle, el } from './view.js';

export function renderDivergenceList(
  result: ComparisonResult,
  projection: DecisionProjection,
  selectedId: string | null,
  onSelect: (id: string) => void,
): HTMLElement {
  const wrap = el('div');
  if (result.divergences.length === 0) {
    wrap.append(el('p', { class: 'muted' }, '两个构建在可操作路径与语义状态上完全一致。'));
    return wrap;
  }
  for (const divergence of result.divergences) {
    const card = el('div', {
      class: `divergence ${divergence.id === selectedId ? 'active' : ''}`,
    });
    const head = el('div', { class: 'head' });
    head.append(
      el(
        'div',
        {},
        el('span', { class: `kind ${divergence.kind}` }, divergence.kind),
        el('div', {}, divergenceTitle(divergence)),
      ),
    );
    head.addEventListener('click', () => onSelect(divergence.id));
    card.append(head);
    const view = projection.views[divergence.id];
    const badges = el('div', { class: 'row' });
    if (view?.conflict) {
      badges.append(el('span', { class: 'badge conflict' }, '研究者冲突'));
    } else if (view?.status && view.status !== 'unclassified') {
      badges.append(
        el('span', { class: `badge ${view.status}` }, view.status === 'intentional' ? '有意' : '回归'),
      );
    }
    if (view?.activeExemptions.length) {
      for (const exemption of view.activeExemptions) {
        badges.append(
          el(
            'span',
            {
              class: `badge ${exemption.status === 'active' ? 'exempt' : 'regression'}`,
            },
            exemption.status === 'active'
              ? `豁免 ${exemption.rangeStart}-${exemption.rangeEnd}`
              : `豁免失效:${exemption.invalidReason ?? ''}`,
          ),
        );
      }
    }
    card.append(badges);
    wrap.append(card);
  }
  return wrap;
}
