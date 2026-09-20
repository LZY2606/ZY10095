import { sha256Hex } from "./hash";
import type {
  Classification, DecisionEvent, DecisionValidity, ExemptionScope,
  Finding, FindingDecisionState, RunReport, StoredBatch
} from "./types";

export interface AppendRequest {
  type: "classify" | "undo";
  operator: string;
  reason: string;
  at?: string;
  findingId?: string;
  classification?: Classification;
  /** For undo: event id to revoke. */
  eventId?: string;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 不能为空`);
  return value.trim();
}

function frameOf(report: RunReport, frameIndex: number) {
  const frame = report.frameReports[frameIndex];
  if (!frame) throw new Error(`frameIndex ${frameIndex} 超出范围`);
  return frame;
}

function signatureAt(report: RunReport, side: "baseline" | "candidate", frameIndex: number, domId: string) {
  const frame = frameOf(report, frameIndex);
  const view = side === "baseline" ? frame.baseline : frame.candidate;
  const sig = view.signatures[domId];
  if (!sig) throw new Error(`第 ${frameIndex} 帧的 ${side} 中找不到节点 ${domId}`);
  return sig;
}

export function exemptionSideFor(finding: Finding): "baseline" | "candidate" {
  if (finding.scope === "cross-build") return "candidate";
  return finding.subjectBuild ?? "candidate";
}

export function exemptionSubjectFor(finding: Finding): string | undefined {
  if (finding.scope === "cross-build") return finding.matchedDomIds?.candidate ?? finding.subjectDomId;
  return finding.subjectDomId ?? finding.matchedDomIds?.candidate ?? finding.matchedDomIds?.baseline;
}

export function buildExemptionScope(
  report: RunReport,
  finding: Finding,
  side: "baseline" | "candidate",
  domId: string,
  buildId: string
): ExemptionScope {
  const sig = signatureAt(report, side, finding.frameIndex, domId);
  const build = side === "baseline" ? report.baseline : report.candidate;
  void buildId;
  return {
    buildId: side === "baseline" ? report.baseline.id : report.candidate.id,
    buildFingerprint: build.fingerprint,
    role: sig.role,
    accessibleName: sig.name,
    ancestorContext: sig.ancestorContext.map((ctx) => ({ ...ctx })),
    frameIndex: finding.frameIndex,
    findingKind: finding.kind
  };
}

export function evaluateExemption(report: RunReport, scope: ExemptionScope): DecisionValidity {
  const reasons: string[] = [];
  let side: "baseline" | "candidate";
  if (report.baseline.id === scope.buildId) side = "baseline";
  else if (report.candidate.id === scope.buildId) side = "candidate";
  else {
    side = "candidate";
    reasons.push(`豁免绑定的构建 ${scope.buildId} 不在当前批次中`);
  }
  const build = side === "baseline" ? report.baseline : report.candidate;
  if (build.fingerprint !== scope.buildFingerprint) {
    reasons.push(`构建指纹变化：${scope.buildFingerprint} → ${build.fingerprint}`);
  }
  const frame = report.frameReports[scope.frameIndex];
  if (!frame) {
    reasons.push(`第 ${scope.frameIndex} 帧不存在`);
    return { status: "invalid-subject", reasons };
  }
  const view = side === "baseline" ? frame.baseline : frame.candidate;
  const matches = frame.matches.filter((match) =>
    side === "baseline" ? match.baselineDomId !== undefined : match.candidateDomId !== undefined
  );
  const found = matches.some((match) => {
    const domId = side === "baseline" ? match.baselineDomId : match.candidateDomId;
    if (!domId) return false;
    const sig = view.signatures[domId];
    if (!sig || sig.role !== scope.role || sig.name !== scope.accessibleName) return false;
    const expected = scope.ancestorContext;
    const actual = sig.ancestorContext;
    if (expected.length !== actual.length) return false;
    return expected.every((ctx, index) =>
      ctx.role === actual[index]!.role && ctx.name === actual[index]!.name
    );
  });
  if (!found) reasons.push("找不到角色、可访问名称与祖先上下文完全一致的节点（节点移动或改名）");
  const status = reasons.length
    ? build.fingerprint !== scope.buildFingerprint
      ? "invalid-fingerprint"
      : "invalid-subject"
    : "active";
  return { status, reasons };
}

function eventId(event: Omit<DecisionEvent, "id">): string {
  return "evt-" + sha256Hex([
    String(event.seq),
    event.type,
    event.operator,
    event.reason,
    event.findingId ?? "",
    event.classification ?? "",
    event.revokes ?? "",
    event.at ?? ""
  ].join("|")).slice(0, 12);
}

function findFinding(report: RunReport, findingId: string): Finding {
  const finding = report.findings.find((item) => item.id === findingId);
  if (!finding) throw new Error(`分歧 ${findingId} 不存在`);
  return finding;
}

function activeClassifications(events: DecisionEvent[], findingId: string): DecisionEvent[] {
  const revoked = new Set<string>();
  for (const event of events) {
    if (event.type === "undo" && event.revokes) revoked.add(event.revokes);
  }
  return events.filter((event) =>
    event.type === "classify" && event.findingId === findingId && !revoked.has(event.id)
  );
}

export function appendDecisionEvent(
  stored: Pick<StoredBatch, "report" | "events">,
  request: AppendRequest
): DecisionEvent {
  const operator = requireText(request.operator, "operator");
  const reason = requireText(request.reason, "reason");
  if (request.at !== undefined && typeof request.at !== "string") {
    throw new Error("at 必须是由调用方提供的时间字符串");
  }
  let event: Omit<DecisionEvent, "id" | "seq">;
  if (request.type === "undo") {
    const targetId = requireText(request.eventId, "eventId");
    const target = stored.events.find((item) => item.id === targetId && item.type === "classify");
    if (!target) throw new Error(`待撤销的分类事件 ${targetId} 不存在`);
    const alreadyUndone = stored.events.some((item) => item.type === "undo" && item.revokes === targetId);
    if (alreadyUndone) throw new Error(`事件 ${targetId} 已被撤销`);
    event = { type: "undo", operator, reason, at: request.at, revokes: targetId, findingId: target.findingId };
  } else {
    const findingId = requireText(request.findingId, "findingId");
    const finding = findFinding(stored.report, findingId);
    const classification = request.classification;
    if (classification !== "defect" && classification !== "intentional" && classification !== "noise") {
      throw new Error("classification 必须是 defect / intentional / noise");
    }
    const base: Omit<DecisionEvent, "id" | "seq"> = {
      type: "classify",
      operator,
      reason,
      at: request.at,
      findingId,
      classification
    };
    if (classification === "intentional") {
      const side = exemptionSideFor(finding);
      const domId = exemptionSubjectFor(finding);
      if (!domId) throw new Error("该分歧无法定位豁免主体节点");
      const scope = buildExemptionScope(stored.report, finding, side, domId, "");
      base.scope = scope;
      base.validity = evaluateExemption(stored.report, scope);
    }
    event = base;
  }
  const seq = stored.events.length
    ? 1 + Math.max(...stored.events.map((item) => item.seq))
    : 0;
  const full: DecisionEvent = { ...event, seq, id: "" } as DecisionEvent;
  const withId: DecisionEvent = { ...full, id: eventId({ ...event, seq }) };
  return withId;
}

export function decisionStates(stored: Pick<StoredBatch, "report" | "events">): FindingDecisionState[] {
  const revoked = new Set<string>();
  for (const event of stored.events) {
    if (event.type === "undo" && event.revokes) revoked.add(event.revokes);
  }
  return stored.report.findings.map((finding) => {
    const history = stored.events
      .filter((event) => event.findingId === finding.id)
      .sort((a, b) => (a.seq - b.seq) || a.id.localeCompare(b.id));
    const active = activeClassifications(stored.events, finding.id);
    const grouped = new Map<Classification, { classification: Classification; count: number; researchers: Set<string> }>();
    for (const event of active) {
      const key = event.classification!;
      const entry = grouped.get(key) ?? { classification: key, count: 0, researchers: new Set<string>() };
      entry.count += 1;
      entry.researchers.add(event.operator);
      grouped.set(key, entry);
    }
    const classifications = [...grouped.values()]
      .map((entry) => ({
        classification: entry.classification,
        count: entry.count,
        researchers: [...entry.researchers].sort()
      }))
      .sort((a, b) => a.classification.localeCompare(b.classification));
    const conflict = grouped.size > 1;
    const intentional = active.find((event) => event.classification === "intentional" && event.scope);
    let exemption: FindingDecisionState["exemption"];
    if (intentional?.scope) {
      const validity = revoked.has(intentional.id)
        ? { status: "revoked" as const, reasons: ["该分类已被撤销"] }
        : evaluateExemption(stored.report, intentional.scope);
      exemption = {
        scope: intentional.scope,
        validity,
        operator: intentional.operator,
        reason: intentional.reason
      };
    }
    return { findingId: finding.id, classifications, conflict, exemption, history };
  });
}
