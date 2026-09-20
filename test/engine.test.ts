import { describe, expect, it } from "vitest";
import { runComparison } from "../src/core/engine";
import { makeSampleBatch } from "./sample-data/sample";
import { validateBatch } from "../src/core/validate";
import type { BatchInput, DomNode } from "../src/core/types";

describe("样本批次引擎", () => {
  const batch = makeSampleBatch();
  const report = runComparison(batch);

  it("每种内置分歧都能检出且带可回放证据", () => {
    const kinds = new Map(report.findings.map((finding) => [finding.kind, finding]));
    expect(kinds.get("focus-trap")).toBeDefined();
    expect(kinds.get("unreachable-popover")).toBeDefined();
    expect(kinds.get("duplicate-announcement")).toBeDefined();
    expect(kinds.get("reachable-set")).toBeDefined();
    expect(kinds.get("semantic-state")).toBeDefined();
    expect(kinds.get("focus-destination")).toBeDefined();

    const trap = kinds.get("focus-trap")!;
    expect(trap.evidence.focusPath.length).toBeGreaterThanOrEqual(3);
    expect(trap.evidence.tabOrder?.length).toBeGreaterThan(0);
    expect(trap.evidence.operationIndices.length).toBe(2);
    const popover = kinds.get("unreachable-popover")!;
    expect(popover.evidence.frameIndices.length).toBe(2);
    const dup = kinds.get("duplicate-announcement")!;
    expect(dup.evidence.announcements).toEqual(["3件の更新を取得しました", "3件の更新を取得しました"]);
  });

  it("颜色变化不产生分歧（只有 pressed 状态差异）", () => {
    const semantic = report.findings.filter((f) => f.kind === "semantic-state");
    expect(semantic.length).toBe(1);
    expect(semantic[0]!.summary).toContain("pressed");
  });

  it("frameReports 含每帧匹配映射", () => {
    expect(report.frameReports).toHaveLength(batch.operations.length + 1);
    for (const frame of report.frameReports) {
      expect(Array.isArray(frame.matches)).toBe(true);
    }
  });

  it("同一输入重复计算得到完全相同的报告（与遍历/时间无关）", () => {
    const again = runComparison(structuredClone(batch));
    expect(again).toEqual(report);
    expect(again.batchId).toBe(report.batchId);
    expect(again.inputFingerprint).toBe(report.inputFingerprint);
  });

  it("输出不依赖对象键插入顺序", () => {
    const reordered = structuredClone(batch) as BatchInput;
    reordered.baseline.frames[1]!.dom = reorderKeys(reordered.baseline.frames[1]!.dom) as DomNode;
    expect(runComparison(reordered).batchId).toBe(report.batchId);
  });
});

function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort().reverse()) out[key] = reorderKeys(source[key]);
    return out;
  }
  return value;
}

describe("校验", () => {
  it("帧数必须为操作数 + 1", () => {
    const batch = makeSampleBatch();
    batch.operations.push({ type: "Tab" });
    const result = validateBatch(batch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("11 帧");
  });

  it("引用不存在的 DOM 节点会被拒绝", () => {
    const batch = makeSampleBatch();
    batch.baseline.frames[1]!.focus!.to = "ghost";
    const result = validateBatch(batch);
    expect(result.ok).toBe(false);
  });

  it("非法操作类型被拒绝", () => {
    const batch = makeSampleBatch();
    (batch.operations[0] as { type: string }).type = "Ctrl+A";
    expect(validateBatch(batch).ok).toBe(false);
  });
});
