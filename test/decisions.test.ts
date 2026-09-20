import { describe, expect, it } from "vitest";
import {
  appendDecisionEvent, buildExemptionScope, decisionStates, evaluateExemption,
  exemptionSideFor, exemptionSubjectFor
} from "../src/core/decisions";
import { runComparison } from "../src/core/engine";
import { makeSampleBatch } from "./sample-data/sample";
import type { StoredBatch } from "../src/core/types";

function stored(): StoredBatch {
  const input = makeSampleBatch();
  const report = runComparison(input);
  return { batchId: report.batchId, input, report, events: [] };
}

const trap = () => runComparison(makeSampleBatch()).findings.find((f) => f.kind === "focus-trap")!;

describe("分类与冲突", () => {
  it("两位研究者不同归类时给出 conflict 且不覆盖", () => {
    const batch = stored();
    const finding = trap();
    batch.events.push(appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "defect",
      operator: "alice", reason: "阻断键盘用户"
    }));
    batch.events.push(appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "intentional",
      operator: "bob", reason: "产品确认保留"
    }));
    const state = decisionStates(batch).find((s) => s.findingId === finding.id)!;
    expect(state.conflict).toBe(true);
    expect(state.classifications.map((c) => c.classification).sort()).toEqual(["defect", "intentional"]);
    expect(state.history).toHaveLength(2);
  });

  it("相同归类不冲突", () => {
    const batch = stored();
    const finding = trap();
    batch.events.push(appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "defect", operator: "a", reason: "x"
    }));
    batch.events.push(appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "defect", operator: "b", reason: "y"
    }));
    const state = decisionStates(batch).find((s) => s.findingId === finding.id)!;
    expect(state.conflict).toBe(false);
    expect(state.classifications[0]!.count).toBe(2);
  });
});

describe("豁免作用域", () => {
  it("作用域绑定角色/名称/祖先/构建指纹", () => {
    const batch = stored();
    const finding = trap();
    const side = exemptionSideFor(finding);
    const domId = exemptionSubjectFor(finding)!;
    const scope = buildExemptionScope(batch.report, finding, side, domId, "");
    expect(scope.role).toBeTruthy();
    expect(scope.buildFingerprint).toBe(batch.input.candidate.fingerprint);
    expect(scope.frameIndex).toBe(finding.frameIndex);
    expect(evaluateExemption(batch.report, scope).status).toBe("active");
  });

  it("构建指纹变化后豁免失效", () => {
    const batch = stored();
    const finding = trap();
    const scope = buildExemptionScope(batch.report, finding, "candidate", finding.subjectDomId!, "");
    batch.input.candidate.fingerprint = "changed-fingerprint";
    batch.report.candidate.fingerprint = "changed-fingerprint";
    const validity = evaluateExemption(batch.report, scope);
    expect(validity.status).toBe("invalid-fingerprint");
    expect(validity.reasons.join("")).toContain("指纹");
  });

  it("节点改名后豁免失效", () => {
    const batch = stored();
    const finding = trap();
    const scope = buildExemptionScope(batch.report, finding, "candidate", finding.subjectDomId!, "");
    const target = batch.input.candidate.frames[finding.frameIndex]!.ax.find((ax) => ax.domId === finding.subjectDomId)!;
    target.name = "別の名前";
    const rebuilt = runComparison(batch.input);
    expect(evaluateExemption(rebuilt, scope).status).toBe("invalid-subject");
  });

  it("分类时记录操作者与理由，撤销产生新事件而不删历史", () => {
    const batch = stored();
    const finding = trap();
    const classify = appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "defect", operator: "a", reason: "r1"
    });
    batch.events.push(classify);
    const undo = appendDecisionEvent(batch, {
      type: "undo", eventId: classify.id, operator: "a", reason: "误点"
    });
    batch.events.push(undo);
    expect(undo.type).toBe("undo");
    expect(undo.revokes).toBe(classify.id);
    expect(batch.events).toHaveLength(2);
    expect(batch.events[0]!.reason).toBe("r1");
    const state = decisionStates(batch).find((s) => s.findingId === finding.id)!;
    expect(state.classifications).toHaveLength(0);
    expect(state.history).toHaveLength(2);
    // 不能重复撤销
    expect(() => appendDecisionEvent(batch, {
      type: "undo", eventId: classify.id, operator: "a", reason: "again"
    })).toThrow();
  });

  it("事件 id 与 seq 确定且递增", () => {
    const batch = stored();
    const finding = trap();
    const e1 = appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "noise", operator: "a", reason: "x"
    });
    expect(e1.seq).toBe(0);
    batch.events.push(e1);
    const e2 = appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "noise", operator: "b", reason: "y"
    });
    expect(e2.seq).toBe(1);
    expect(e1.id).not.toBe(e2.id);
    const batch2 = stored();
    const again = appendDecisionEvent(batch2, {
      type: "classify", findingId: finding.id, classification: "noise", operator: "a", reason: "x"
    });
    expect(again.id).toBe(e1.id);
  });
});

describe("豁免の境界", () => {
  it("ノードが別の祖先コンテキストへ移動すると豁免は無効", () => {
    const batch = stored();
    const finding = trap();
    const scope = buildExemptionScope(batch.report, finding, "candidate", finding.subjectDomId!, "");
    // Wrap the trap subject's container menu with an extra named section:
    // change by renaming account-menu's accessible name changes ancestor chain
    const frame = batch.input.candidate.frames[finding.frameIndex]!;
    const menuAx = frame.ax.find((ax) => ax.domId === "account-menu");
    expect(menuAx).toBeDefined();
    menuAx!.name = "別のメニュー";
    const rebuilt = runComparison(batch.input);
    const validity = evaluateExemption(rebuilt, scope);
    expect(validity.status).toBe("invalid-subject");
    expect(validity.reasons.join("")).toMatch(/祖先|移動|改名/);
  });

  it("撤销後に別の分類を出せば競合なし（新イベントとして残る）", () => {
    const batch = stored();
    const finding = trap();
    const first = appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "noise", operator: "a", reason: "x"
    });
    batch.events.push(first);
    const undo = appendDecisionEvent(batch, {
      type: "undo", eventId: first.id, operator: "a", reason: "取消"
    });
    batch.events.push(undo);
    const second = appendDecisionEvent(batch, {
      type: "classify", findingId: finding.id, classification: "defect", operator: "b", reason: "y"
    });
    batch.events.push(second);
    const state = decisionStates(batch).find((s) => s.findingId === finding.id)!;
    expect(state.conflict).toBe(false);
    expect(state.classifications.map((c) => c.classification)).toEqual(["defect"]);
    expect(state.history.map((e) => e.type)).toEqual(["classify", "undo", "classify"]);
  });
});
