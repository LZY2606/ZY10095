import { describe, expect, it } from "vitest";
import { buildFrameModel } from "../src/core/derive";
import { matchFrames } from "../src/core/match";
import type { Frame } from "../src/core/types";

function simpleFrame(dom: Frame["dom"], index = 0): ReturnType<typeof buildFrameModel> {
  return buildFrameModel({ index, dom, ax: [] });
}

describe("节点匹配", () => {
  it("稳定 id 命中 exact，即使 shadow 包裹移动", () => {
    const base = simpleFrame({ id: "r", tag: "div", children: [
      { id: "btn", tag: "button", attrs: { "data-gsb-id": "save", "aria-label": "保存" } }
    ] });
    const cand = simpleFrame({ id: "r", tag: "div", children: [
      { id: "host", tag: "div", shadowHost: true, children: [
        { id: "btn2", tag: "button", attrs: { "data-gsb-id": "save", "aria-label": "保存" } }
      ] }
    ] });
    const sets = matchFrames(base, cand);
    const pair = sets.matches.find((m) => m.baselineDomId === "btn");
    expect(pair?.candidateDomId).toBe("btn2");
    expect(pair?.confidence).toBe("exact");
    expect(pair?.evidence.stableId).toBe(true);
  });

  it("名称不同且无稳定证据时不强配，保留新增/消失", () => {
    const base = simpleFrame({ id: "r", tag: "div", children: [
      { id: "x", tag: "button", text: "旧名前" }
    ] });
    const cand = simpleFrame({ id: "r", tag: "div", children: [
      { id: "y", tag: "button", text: "新しい名前" }
    ] });
    const sets = matchFrames(base, cand);
    expect(sets.removed).toEqual(["x"]);
    expect(sets.added).toEqual(["y"]);
  });

  it("祖先上下文保留时重挂载仍可匹配（high）", () => {
    const base = simpleFrame({ id: "r", tag: "div", children: [
      { id: "sec", tag: "section", attrs: { "aria-label": "設定" }, children: [
        { id: "btn", tag: "button", text: "実行" }
      ] }
    ] });
    const cand = simpleFrame({ id: "r", tag: "div", children: [
      { id: "wrap", tag: "div", children: [
        { id: "sec2", tag: "section", attrs: { "aria-label": "設定" }, children: [
          { id: "btn2", tag: "button", text: "実行" }
        ] }
      ] }
    ] });
    const sets = matchFrames(base, cand);
    const pair = sets.matches.find((m) => m.baselineDomId === "btn");
    expect(pair?.candidateDomId).toBe("btn2");
    expect(["high", "medium"]).toContain(pair?.confidence);
  });

  it("纯颜色/class 变化不降低匹配", () => {
    const base = simpleFrame({ id: "r", tag: "div", children: [
      { id: "btn", tag: "button", attrs: { "data-gsb-id": "go", class: "blue" }, text: "進む" }
    ] });
    const cand = simpleFrame({ id: "r", tag: "div", children: [
      { id: "btn", tag: "button", attrs: { "data-gsb-id": "go", class: "red", style: "color:red" }, text: "進む" }
    ] });
    const sets = matchFrames(base, cand);
    expect(sets.matches.find((m) => m.baselineDomId === "btn")?.confidence).toBe("exact");
  });

  it("一对一分组：两个相同节点不会被配到同一个候选", () => {
    const base = simpleFrame({ id: "r", tag: "div", children: [
      { id: "b1", tag: "button", attrs: { "data-gsb-id": "one" }, text: "1" },
      { id: "b2", tag: "button", attrs: { "data-gsb-id": "two" }, text: "2" }
    ] });
    const cand = simpleFrame({ id: "r", tag: "div", children: [
      { id: "c1", tag: "button", attrs: { "data-gsb-id": "one" }, text: "1" },
      { id: "c2", tag: "button", attrs: { "data-gsb-id": "two" }, text: "2" }
    ] });
    const sets = matchFrames(base, cand);
    const candidateTargets = sets.matches.filter((m) => m.confidence !== "none").map((m) => m.candidateDomId);
    expect(new Set(candidateTargets).size).toBe(candidateTargets.length);
  });
});
