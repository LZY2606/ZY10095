import { describe, expect, it } from "vitest";
import { buildFrameModel } from "../src/core/derive";
import type { Frame, KeyOp } from "../src/core/types";
import { applyKey } from "../src/core/derive";

function frame(partial: Partial<Frame> & { index: number; dom: Frame["dom"]; ax: Frame["ax"] }): Frame {
  return partial as Frame;
}

describe("tab 顺序", () => {
  const base = (focus?: string): Frame => frame({
    index: 0,
    dom: {
      id: "root", tag: "div",
      children: [
        { id: "a", tag: "button", text: "A" },
        { id: "b", tag: "div", attrs: { role: "button", tabindex: "0" }, text: "B" },
        { id: "c", tag: "button", attrs: { disabled: "" }, text: "C" },
        { id: "d", tag: "button", attrs: { tabindex: "-1" }, text: "D" },
        { id: "e", tag: "div", attrs: { "aria-hidden": "true" }, children: [
          { id: "e1", tag: "button", text: "隠しボタン" }
        ] }
      ]
    },
    ax: [],
    ...(focus ? { focus: { to: focus } } : {})
  });

  it("仅包含可到达的、可见且非禁用的控件", () => {
    const model = buildFrameModel(base());
    expect(model.orderedReachable).toEqual(["a", "b"]);
  });

  it("tabindex 正数优先且按值排序", () => {
    const f = base();
    f.dom.children!.push(
      { id: "x", tag: "button", attrs: { tabindex: "2" }, text: "X" },
      { id: "y", tag: "button", attrs: { tabindex: "1" }, text: "Y" }
    );
    const model = buildFrameModel(f);
    expect(model.orderedReachable).toEqual(["y", "x", "a", "b"]);
  });

  it("Tab 沿顺序前进，Shift+Tab 后退", () => {
    expect(applyKey({ type: "Tab" } as KeyOp, buildFrameModel(base("b")), buildFrameModel(base("a"))).expectedFocusTo).toBe("b");
    // No wrap: Tab past the last item has no target.
    expect(applyKey({ type: "Tab" } as KeyOp, buildFrameModel(base(undefined)), buildFrameModel(base("b"))).expectedFocusTo).toBeUndefined();
    // Shift+Tab moves backwards.
    expect(applyKey({ type: "ShiftTab" } as KeyOp, buildFrameModel(base("a")), buildFrameModel(base("b"))).expectedFocusTo).toBe("a");
  });

  it("模态层将 Tab 范围限制在层内", () => {
    const f = base();
    f.dom.children!.push({
      id: "dlg", tag: "div",
      attrs: { role: "dialog", "aria-modal": "true" },
      children: [
        { id: "ok", tag: "button", text: "OK" }
      ]
    });
    f.ax = [{ id: "ax-dlg", domId: "dlg", role: "dialog", states: { visible: true, modal: true } }];
    const model = buildFrameModel(f);
    expect(model.orderedReachable).toEqual(["ok"]);
  });

  it("shadow host 的子树仍参与文档 Tab 遍历", () => {
    const f = base();
    f.dom.children!.unshift({
      id: "host", tag: "div", shadowHost: true,
      children: [{ id: "sbtn", tag: "button", attrs: { "data-gsb-id": "shadow-btn" }, text: "影" }]
    });
    const model = buildFrameModel(f);
    expect(model.orderedReachable).toEqual(["sbtn", "a", "b"]);
    expect(model.signatures.get("sbtn")!.inShadow).toBe(true);
  });

  it("隐藏层容器的子孙在层关闭时不可达，打开后可达", () => {
    const closed = buildFrameModel({
      index: 0,
      dom: { id: "root", tag: "div", children: [
        { id: "menu", tag: "div", attrs: { role: "menu", hidden: "" }, children: [
          { id: "mi", tag: "a", attrs: { role: "menuitem", tabindex: "0", href: "#" }, text: "項目" }
        ] }
      ] },
      ax: [{ id: "ax-menu", domId: "menu", role: "menu", states: { visible: false } }]
    });
    expect(closed.orderedReachable).toEqual([]);
    const opened = buildFrameModel({
      index: 1,
      dom: { id: "root", tag: "div", children: [
        { id: "menu", tag: "div", attrs: { role: "menu" }, children: [
          { id: "mi", tag: "a", attrs: { role: "menuitem", tabindex: "0", href: "#" }, text: "項目" }
        ] }
      ] },
      ax: [{ id: "ax-menu", domId: "menu", role: "menu", states: { visible: true } }]
    });
    expect(opened.orderedReachable).toEqual(["mi"]);
  });
});
