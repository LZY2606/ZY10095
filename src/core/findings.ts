import type { FrameModel } from "./derive";
import { layerRole } from "./derive";
import { canonicalJson } from "./hash";
import type {
  Finding, FindingKind, FrameReport, KeyOp, NodeMatch, NodeSignature, Severity
} from "./types";

const SEVERITY: Record<FindingKind, Severity> = {
  "focus-destination": "major",
  "reachable-set": "major",
  "semantic-state": "major",
  "focus-trap": "blocker",
  "unreachable-popover": "blocker",
  "duplicate-announcement": "minor"
};

function isLayer(sig: NodeSignature): boolean {
  return sig.visible && layerRole(sig.role);
}

function isInside(model: FrameModel, domId: string | undefined, ancestorId: string): boolean {
  if (!domId) return false;
  return domId === ancestorId || (model.flat.get(domId)?.ancestors.includes(ancestorId) ?? false);
}

function semanticSubtree(model: FrameModel, id: string): unknown {
  const simplify = (domId: string): unknown => {
    const entry = model.flat.get(domId);
    if (!entry) return null;
    const attrs: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry.node.attrs ?? {})) {
      if (key === "class" || key === "style" || key.startsWith("data-color")) continue;
      attrs[key] = value!;
    }
    return {
      id: entry.node.id,
      tag: entry.node.tag,
      shadowHost: entry.node.shadowHost === true,
      attrs,
      text: entry.node.text ?? "",
      children: entry.node.children?.map((child) => simplify(child.id)) ?? []
    };
  };
  return simplify(id);
}

interface CrossContext {
  operations: KeyOp[];
  bFrames: FrameModel[];
  cFrames: FrameModel[];
  frameReports: FrameReport[];
}

function pairFor(matches: NodeMatch[], domId: string, side: "baseline" | "candidate"): NodeMatch | undefined {
  return matches.find((match) =>
    match.confidence !== "none" &&
    (side === "baseline" ? match.baselineDomId === domId : match.candidateDomId === domId)
  );
}

const STATE_KEYS: (keyof NodeSignature["states"])[] = [
  "disabled", "selected", "checked", "expanded", "pressed", "readonly", "required"
];

function compareStates(bs: NodeSignature, cs: NodeSignature): string[] {
  const diffs: string[] = [];
  for (const key of STATE_KEYS) {
    if (bs.states[key] !== cs.states[key]) {
      diffs.push(`${key}: ${bs.states[key] ? "true" : "false"} → ${cs.states[key] ? "true" : "false"}`);
    }
  }
  if (bs.name !== cs.name) diffs.push(`name: "${bs.name}" → "${cs.name}"`);
  return diffs;
}

function isInteractive(sig: NodeSignature): boolean {
  return sig.tabReachable || sig.focusable;
}

export function crossBuildFindings(ctx: CrossContext): Finding[] {
  const findings: Finding[] = [];
  const reachableSeen = new Set<string>();
  const semanticSeen = new Set<string>();

  for (const report of ctx.frameReports) {
    const frameIndex = report.index;
    // Frame 0 is the pre-sequence state; cross-build divergence is only
    // meaningful after a shared operation has been applied.
    if (frameIndex === 0) continue;
    const op = ctx.operations[frameIndex - 1]!;
    const bModel = ctx.bFrames[frameIndex]!;
    const cModel = ctx.cFrames[frameIndex]!;

    // 1. Focus destination divergence.
    const bFocus = bModel.observedFocusTo;
    const cFocus = cModel.observedFocusTo;
    if ((bFocus ?? null) !== (cFocus ?? null)) {
      const pair = bFocus && cFocus ? pairFor(report.matches, bFocus, "baseline") : undefined;
      const sameSemantic = pair?.candidateDomId === cFocus;
      if (!sameSemantic) {
        findings.push({
          id: deterministicId("focus-destination", "cross", String(frameIndex), bFocus ?? "_", cFocus ?? "_"),
          kind: "focus-destination",
          scope: "cross-build",
          severity: SEVERITY["focus-destination"],
          frameIndex,
          operationIndex: frameIndex > 0 ? frameIndex - 1 : undefined,
          matchedDomIds: { baseline: bFocus, candidate: cFocus },
          summary: `焦点去向不同：基线 ${labelFor(bModel, bFocus)}，候选 ${labelFor(cModel, cFocus)}`,
          evidence: {
            operationIndices: frameIndex > 0 ? [frameIndex - 1] : [],
            frameIndices: [frameIndex],
            focusPath: [bFocus ?? "", cFocus ?? ""].filter(Boolean),
            detail: `操作 ${op.type} 後に観測されたフォーカス目標が異なります`
          }
        });
      }
    }

    // 2. Reachable set: added/removed tab-reachable controls.
    for (const match of report.matches) {
      const bs = match.baselineDomId ? bModel.signatures.get(match.baselineDomId) : undefined;
      const cs = match.candidateDomId ? cModel.signatures.get(match.candidateDomId) : undefined;
      const interactive = (bs ? isInteractive(bs) : false) || (cs ? isInteractive(cs) : false);
      if (!interactive || match.confidence !== "none") continue;
      const key = match.baselineDomId ? `removed:${match.role}:${match.name}` : `added:${match.role}:${match.name}`;
      if (reachableSeen.has(key)) continue;
      reachableSeen.add(key);
      const removed = !!(match.baselineDomId && !match.candidateDomId);
      findings.push({
        id: deterministicId("reachable-set", removed ? "removed" : "added", match.role, match.name),
        kind: "reachable-set",
        scope: "cross-build",
        severity: SEVERITY["reachable-set"],
        frameIndex,
        subjectDomId: match.baselineDomId ?? match.candidateDomId,
        subjectBuild: removed ? "baseline" : "candidate",
        matchedDomIds: { baseline: match.baselineDomId, candidate: match.candidateDomId },
        summary: removed
          ? `可达控件在候选中消失：${match.role} “${match.name}”`
          : `候选出现新的可达控件：${match.role} “${match.name}”`,
        evidence: {
          operationIndices: frameIndex > 0 ? [frameIndex - 1] : [],
          frameIndices: [frameIndex],
          focusPath: [],
          tabOrder: removed ? bModel.orderedReachable : cModel.orderedReachable,
          detail: removed
            ? "该控件在基线可通过键盘到达，候选无法匹配到稳定身份，按消失处理"
            : "该控件在候选可通过键盘到达，基线无法匹配到稳定身份，按新增处理"
        }
      });
    }

    // 3. Semantic state/name divergence for matched interactive pairs.
    for (const match of report.matches) {
      if (match.confidence === "none" || !match.baselineDomId || !match.candidateDomId) continue;
      const bs = bModel.signatures.get(match.baselineDomId)!;
      const cs = cModel.signatures.get(match.candidateDomId)!;
      if (!isInteractive(bs) && !isInteractive(cs)) continue;
      const diffs = compareStates(bs, cs);
      if (!diffs.length) continue;
      const key = `${match.baselineDomId}:${match.candidateDomId}:${diffs.join("|")}`;
      if (semanticSeen.has(key)) continue;
      semanticSeen.add(key);
      findings.push({
        id: deterministicId("semantic-state", match.baselineDomId, match.candidateDomId, diffs.join(",")),
        kind: "semantic-state",
        scope: "cross-build",
        severity: SEVERITY["semantic-state"],
        frameIndex,
        matchedDomIds: { baseline: match.baselineDomId, candidate: match.candidateDomId },
        summary: `语义状态不同：${bs.role} “${bs.name || cs.name}” — ${diffs.join("；")}`,
        evidence: {
          operationIndices: frameIndex > 0 ? [frameIndex - 1] : [],
          frameIndices: [frameIndex],
          focusPath: [],
          detail: `仅比较角色/名称/ARIA 状态等语义；颜色、class、style 变化不产生结论（置信 ${match.confidence}）`
        }
      });
    }
  }
  return findings;
}

function labelFor(model: FrameModel, domId: string | undefined): string {
  if (!domId) return "（无焦点）";
  const sig = model.signatures.get(domId);
  return sig ? `${sig.role} “${sig.name || domId}”` : domId;
}

function visibleLayerRoots(model: FrameModel): string[] {
  const roots: string[] = [];
  for (const id of model.order) {
    const sig = model.signatures.get(id)!;
    if (isLayer(sig)) roots.push(id);
  }
  return roots;
}

function focusTrapFindings(
  buildId: string,
  operations: KeyOp[],
  frames: FrameModel[]
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (let end = 2; end < frames.length; end++) {
    const ops = [operations[end - 2]?.type, operations[end - 1]?.type];
    if (!ops.every((type) => type === "Tab" || type === "ShiftTab")) continue;
    const path = [frames[end - 2]!.observedFocusTo, frames[end - 1]!.observedFocusTo, frames[end]!.observedFocusTo];
    if (path.some((target) => !target)) continue;
    const repeats = new Set(path).size < path.length;
    if (!repeats) continue;
    const model = frames[end]!;
    let container: string | undefined;
    for (const layerId of visibleLayerRoots(model)) {
      if (path.every((target) => isInside(model, target, layerId))) {
        container = layerId;
        break;
      }
    }
    if (!container) continue;
    const hasReachableOutside = model.orderedReachable.some((id) => !isInside(model, id, container!));
    if (!hasReachableOutside) continue;
    const key = `${buildId}:${container}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sig = model.signatures.get(container)!;
    findings.push({
      id: deterministicId("focus-trap", buildId, container),
      kind: "focus-trap",
      scope: "build-specific",
      severity: SEVERITY["focus-trap"],
      frameIndex: end,
      operationIndex: end - 1,
      subjectDomId: container,
      subjectBuild: buildId === "baseline" ? "baseline" : "candidate",
      summary: `焦点陷阱：连续 Tab 后焦点未离开 ${sig.role} “${sig.name || container}”，弹层外仍有可达节点`,
      evidence: {
        operationIndices: [end - 2, end - 1],
        frameIndices: [end - 2, end - 1, end],
        focusPath: path as string[],
        tabOrder: model.orderedReachable,
        detail: sig.states.modal
          ? "弹层声明 modal，但弹层外存在可达节点；核对焦点环回是否符合预期"
          : "非模态弹层内焦点被环回，Tab 无法到达弹层后的页面节点"
      }
    });
  }
  return findings;
}

function layerVisible(sig: NodeSignature): boolean {
  return !!sig && isLayer(sig) && sig.visible;
}

function unreachablePopoverFindings(
  buildId: string,
  operations: KeyOp[],
  frames: FrameModel[]
): Finding[] {
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (let start = 1; start < frames.length; start++) {
    const previous = frames[start - 1]!;
    const first = frames[start]!;
    for (const layerId of first.order) {
      const sig = first.signatures.get(layerId)!;
      const prevSig = previous.signatures.get(layerId);
      const newlyVisible = layerVisible(sig) && (!prevSig || !layerVisible(prevSig));
      if (!newlyVisible || reported.has(`${buildId}:${layerId}`)) continue;
      // Examine the whole visible interval: focus may legitimately remain on
      // the trigger for Enter-open and move in on the next Tab.
      let end = start;
      while (end + 1 < frames.length && layerVisible(frames[end + 1]!.signatures.get(layerId)!)) end++;
      const interval = frames.slice(start, end + 1);
      const everEntered = interval.some((model) =>
        model.observedFocusTo === layerId || isInside(model, model.observedFocusTo, layerId)
      );
      const reachableInside = first.orderedReachable.some((id) =>
        id !== layerId && isInside(first, id, layerId)
      );
      if (everEntered && reachableInside) continue;
      reported.add(`${buildId}:${layerId}`);
      const reasons: string[] = [];
      if (!reachableInside) reasons.push("弹层内无 Tab 可达节点");
      if (!everEntered) reasons.push(`第 ${start}-${end} 帧可见期间焦点始终未进入弹层`);
      findings.push({
        id: deterministicId("unreachable-popover", buildId, layerId),
        kind: "unreachable-popover",
        scope: "build-specific",
        severity: SEVERITY["unreachable-popover"],
        frameIndex: start,
        operationIndex: start - 1,
        subjectDomId: layerId,
        subjectBuild: buildId === "baseline" ? "baseline" : "candidate",
        summary: `不可达弹层：${sig.role} “${sig.name || layerId}” 对键盘用户不可达`,
        evidence: {
          operationIndices: [start - 1],
          frameIndices: [start - 1, end],
          focusPath: interval.map((model) => model.observedFocusTo ?? "").filter(Boolean),
          tabOrder: first.orderedReachable,
          detail: reasons.join("；")
        }
      });
    }
  }
  return findings;
}

function duplicateAnnouncementFindings(buildId: string, frames: FrameModel[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  // Same-frame duplicates.
  for (const model of frames) {
    const byRegion = new Map<string, string[]>();
    for (const announcement of model.announcements) {
      const regionId = announcement.regionId ?? "";
      const list = byRegion.get(regionId) ?? [];
      list.push(announcement.text);
      byRegion.set(regionId, list);
    }
    for (const [regionId, texts] of byRegion) {
      if (texts.length < 2) continue;
      const text = texts[0]!;
      if (!texts.every((item) => item === text)) continue;
      const key = `${buildId}:${regionId}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        id: deterministicId("duplicate-announcement", buildId, regionId, text),
        kind: "duplicate-announcement",
        scope: "build-specific",
        severity: SEVERITY["duplicate-announcement"],
        frameIndex: model.index,
        ...(model.index > 0 ? { operationIndex: model.index - 1 } : {}),
        subjectDomId: regionId || undefined,
        subjectBuild: buildId === "baseline" ? "baseline" : "candidate",
        summary: `live region 重复播报：“${text}”`,
        evidence: {
          operationIndices: model.index > 0 ? [model.index - 1] : [],
          frameIndices: [model.index],
          focusPath: [],
          announcements: [text, text],
          detail: regionId ? `区域 ${regionId} 在同一帧内重复播报同一文本` : "同一播报文本在同一帧内重复"
        }
      });
    }
  }
  // Consecutive-frame duplicates without a content change.
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!;
    const current = frames[i]!;
    for (const announcement of current.announcements) {
      const regionId = announcement.regionId ?? "";
      const previous = prev.announcements.find((item) =>
        (item.regionId ?? "") === regionId && item.text === announcement.text
      );
      if (!previous) continue;
      const regionNode = regionId ? current.flat.get(regionId)?.node : undefined;
      let changed = false;
      if (regionNode) {
        changed =
          canonicalJson(semanticSubtree(current, regionId)) !==
          canonicalJson(semanticSubtree(prev, regionId));
      }
      if (changed) continue;
      const key = `${buildId}:${regionId}:${announcement.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        id: deterministicId("duplicate-announcement", buildId, regionId, announcement.text),
        kind: "duplicate-announcement",
        scope: "build-specific",
        severity: SEVERITY["duplicate-announcement"],
        frameIndex: i,
        operationIndex: i - 1,
        subjectDomId: regionId || undefined,
        subjectBuild: buildId === "baseline" ? "baseline" : "candidate",
        summary: `live region 重复播报：“${announcement.text}”`,
        evidence: {
          operationIndices: [i - 1],
          frameIndices: [i - 1, i],
          focusPath: [],
          announcements: [announcement.text, announcement.text],
          detail: regionId
            ? `区域 ${regionId} 在内容未变化时连续播报同一文本`
            : "同一播报文本在相邻帧重复出现且未标记区域变化"
        }
      });
    }
  }
  return findings;
}

function focusSkipFindings(buildId: string, operations: KeyOp[], frames: FrameModel[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 1; i < frames.length; i++) {
    const op = operations[i - 1]!;
    if (op.type !== "Tab" && op.type !== "ShiftTab") continue;
    const current = frames[i]!;
    if (!current.focusMovedUnexpectedly || !current.expectedFocusTo) continue;
    const expected = current.expectedFocusTo;
    const observed = current.observedFocusTo;
    if (!observed) continue;
    const coveredByTrap = visibleLayerRoots(current).some((layerId) =>
      isInside(current, expected, layerId) && isInside(current, observed, layerId)
    );
    if (coveredByTrap) continue;
    findings.push({
      id: deterministicId("focus-destination", buildId, String(i), expected, observed),
      kind: "focus-destination",
      scope: "build-specific",
      severity: SEVERITY["focus-destination"],
      frameIndex: i,
      operationIndex: i - 1,
      subjectDomId: observed,
      subjectBuild: buildId === "baseline" ? "baseline" : "candidate",
      summary: `焦点跳转异常：期望 ${labelFor(current, expected)}，实际 ${labelFor(current, observed)}`,
      evidence: {
        operationIndices: [i - 1],
        frameIndices: [i],
        focusPath: [expected, observed],
        tabOrder: current.orderedReachable,
        detail: "观察到的焦点目标不在 Tab 顺序的下一位置"
      }
    });
  }
  return findings;
}

export function buildSpecificFindings(
  buildId: "baseline" | "candidate",
  operations: KeyOp[],
  frames: FrameModel[]
): Finding[] {
  return [
    ...focusTrapFindings(buildId, operations, frames),
    ...unreachablePopoverFindings(buildId, operations, frames),
    ...duplicateAnnouncementFindings(buildId, frames),
    ...focusSkipFindings(buildId, operations, frames)
  ].sort((a, b) =>
    (a.frameIndex - b.frameIndex) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
  );
}

import { sha256Hex } from "./hash";

function deterministicId(kind: string, ...parts: string[]): string {
  return `${kind}-${sha256Hex([kind, ...parts].join("|")).slice(0, 10)}`;
}
