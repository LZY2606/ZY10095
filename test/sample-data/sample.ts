import type {
  AxNode, BatchInput, BuildInput, DomNode, Frame, KeyOp
} from "../../src/core/types";

/**
 * 演示/测试数据（保存的输入，不是实时浏览器）。
 *
 * 两个构建共享同一条键盘序列，候选中刻意植入：
 *  - 新增“通知”按钮、移除“閉じる”菜单项（可达集合 + 稳定身份匹配）
 *  - header 使用 shadow root（不能按 CSS 路径认同节点）
 *  - 菜单焦点环回（focus trap，可回放）
 *  - 打开菜单时出现无法进入的 popover（不可达弹层）
 *  - live region 内容未变却重复播报
 *  - “更新”按钮 aria-pressed 状态不同（语义状态）
 *  - “更新”按钮颜色变化（不得产生分歧）
 */

interface BuildSpec {
  id: string;
  label: string;
  fingerprint: string;
  shadowHeader: boolean;
  hasNotification: boolean;
  hasCloseItem: boolean;
  hasHints: boolean;
  pressedRefresh: boolean;
  duplicateAnnouncement: boolean;
  refreshColor: string;
}

interface FrameOpts {
  index: number;
  focus?: string;
  menuOpen: boolean;
  liveText: string;
  announcements?: { regionId: string; text: string; polite?: boolean }[];
}

function el(
  id: string,
  tag: string,
  opts: {
    attrs?: Record<string, string>;
    text?: string;
    children?: DomNode[];
    shadowHost?: boolean;
  } = {}
): DomNode {
  return {
    id,
    tag,
    ...(opts.attrs ? { attrs: opts.attrs } : {}),
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.shadowHost ? { shadowHost: true } : {}),
    ...(opts.children?.length ? { children: opts.children } : {})
  };
}

function buildDom(spec: BuildSpec, opts: FrameOpts): DomNode {
  const menuAttrs: Record<string, string> = { "aria-labelledby": "menu-button" };
  if (!opts.menuOpen) menuAttrs.hidden = "";
  const menuItems = [
    el("menu-profile", "a", { attrs: { role: "menuitem", href: "#profile", tabindex: "0" }, text: "プロフィール" }),
    el("menu-settings", "a", { attrs: { role: "menuitem", href: "#settings", tabindex: "0" }, text: "設定" }),
    ...(spec.hasCloseItem
      ? [el("menu-close", "a", { attrs: { role: "menuitem", href: "#close", tabindex: "0" }, text: "閉じる" })]
      : [])
  ];
  const refreshAttrs: Record<string, string> = { "data-gsb-id": "refresh-btn" };
  if (spec.pressedRefresh) refreshAttrs["aria-pressed"] = "true";
  refreshAttrs.style = `background:${spec.refreshColor}`;

  const headerChildren = [
    el("title", "h1", { text: "設定" }),
    el("menu-button", "button", {
      attrs: {
        "data-gsb-id": "account-menu-button",
        "aria-haspopup": "menu",
        "aria-expanded": String(opts.menuOpen),
        "aria-controls": "account-menu"
      },
      text: "メニュー"
    }),
    ...(spec.hasNotification
      ? [el("notification", "button", { attrs: { "data-gsb-id": "notification-btn" }, text: "通知" })]
      : [])
  ];

  const mainChildren = [
    el("refresh", "button", { attrs: refreshAttrs, text: "更新" }),
    el("save", "button", { attrs: { "data-gsb-id": "save-btn" }, text: "保存" }),
    el("status", "div", { attrs: { role: "status", "aria-live": "polite" }, text: opts.liveText }),
    ...(spec.hasHints && opts.menuOpen
      ? [el("hints", "div", {
          attrs: { role: "popover", popover: "auto", "aria-label": "ヒント" },
          text: "ショートカット: ? でヘルプを開く"
        })]
      : []),
    el("account-menu", "div", { attrs: menuAttrs, children: menuItems })
  ];

  return el("app", "div", {
    children: [
      el("banner", "header", spec.shadowHeader ? { shadowHost: true, children: headerChildren } : { children: headerChildren }),
      el("main", "main", { children: mainChildren }),
      el("footer", "footer", { text: "© 2026" })
    ]
  });
}

function buildAx(spec: BuildSpec, opts: FrameOpts): AxNode[] {
  void spec;
  const nodes: AxNode[] = [
    { id: "ax-app", domId: "app", role: "generic" },
    { id: "ax-banner", domId: "banner", role: "banner" },
    { id: "ax-title", domId: "title", role: "heading", name: "設定" },
    {
      id: "ax-menu-button",
      domId: "menu-button",
      role: "button",
      name: "メニュー",
      states: { expanded: opts.menuOpen }
    },
    { id: "ax-main", domId: "main", role: "main" },
    {
      id: "ax-refresh",
      domId: "refresh",
      role: "button",
      name: "更新",
      states: { pressed: spec.pressedRefresh && opts.index >= 9 }
    },
    { id: "ax-save", domId: "save", role: "button", name: "保存" },
    {
      id: "ax-status",
      domId: "status",
      role: "status",
      name: opts.liveText,
      states: { live: "polite" }
    },
    { id: "ax-account-menu", domId: "account-menu", role: "menu", name: "アカウントメニュー", states: { visible: opts.menuOpen } },
    { id: "ax-menu-profile", domId: "menu-profile", role: "menuitem", name: "プロフィール" },
    { id: "ax-menu-settings", domId: "menu-settings", role: "menuitem", name: "設定" },
    { id: "ax-footer", domId: "footer", role: "contentinfo", name: "© 2026" }
  ];
  if (spec.hasNotification) {
    nodes.push({ id: "ax-notification", domId: "notification", role: "button", name: "通知" });
  }
  if (spec.hasCloseItem) {
    nodes.push({ id: "ax-menu-close", domId: "menu-close", role: "menuitem", name: "閉じる" });
  }
  if (spec.hasHints && opts.menuOpen) {
    nodes.push({ id: "ax-hints", domId: "hints", role: "popover", name: "ヒント", states: { visible: true } });
  }
  if (opts.focus) {
    const target = nodes.find((node) => node.domId === opts.focus);
    if (target) target.states = { ...(target.states ?? {}), focused: true };
  }
  return nodes;
}

const OPERATIONS: KeyOp[] = [
  { type: "Tab", label: "メニューボタンへ" },
  { type: "Enter", label: "メニューを開く" },
  { type: "Tab", label: "1項目へ" },
  { type: "Tab", label: "2項目へ" },
  { type: "Tab", label: "次の項目へ（候補では先頭に戻る）" },
  { type: "Tab", label: "再度循環（候補でトラップ証拠が完成）" },
  { type: "Escape", label: "メニューを閉じる" },
  { type: "Tab", label: "更新ボタンへ" },
  { type: "Enter", label: "更新を実行（候補では同じ live 通知が連続）" }
];

const LIVE_IDLE = "前回の更新: 09:00";
const LIVE_DONE = "3件の更新を取得しました";

function buildFrames(spec: BuildSpec, focusPath: (string | undefined)[]): Frame[] {
  const menuOpenAt = (index: number) => index >= 2 && index <= 6;
  return focusPath.map((focus, index) => {
    const liveText = index >= 9 ? LIVE_DONE : LIVE_IDLE;
    const announcements =
      index === 9
        ? [{ regionId: "status", text: LIVE_DONE, polite: true },
           ...(spec.duplicateAnnouncement ? [{ regionId: "status", text: LIVE_DONE, polite: true }] : [])]
        : [];
    const opts: FrameOpts = { index, focus, menuOpen: menuOpenAt(index), liveText, announcements };
    const frame: Frame = {
      index,
      dom: buildDom(spec, opts),
      ax: buildAx(spec, opts),
      ...(announcements.length ? { announcements } : {}),
      ...(index > 0 ? { focus: { to: focus, from: focusPath[index - 1] } } : {})
    };
    return frame;
  });
}

const BASELINE_FOCUS = [
  undefined,
  "menu-button",
  "menu-button",
  "menu-profile",
  "menu-settings",
  "menu-close",
  "refresh",
  "menu-button",
  "refresh",
  "refresh"
] as const;

const CANDIDATE_FOCUS = [
  undefined,
  "notification",
  "menu-button",
  "menu-profile",
  "menu-settings",
  "menu-profile",
  "menu-settings",
  "notification",
  "refresh",
  "refresh"
] as const;

const BASELINE_SPEC: BuildSpec = {
  id: "build-baseline",
  label: "基线（本番ビルド）",
  fingerprint: "base-2026-09-21-aaaa",
  shadowHeader: false,
  hasNotification: false,
  hasCloseItem: true,
  hasHints: false,
  pressedRefresh: false,
  duplicateAnnouncement: false,
  refreshColor: "#e0e0e0"
};

const CANDIDATE_SPEC: BuildSpec = {
  id: "build-candidate",
  label: "候选（候補ビルド）",
  fingerprint: "cand-2026-09-21-bbbb",
  shadowHeader: true,
  hasNotification: true,
  hasCloseItem: false,
  hasHints: true,
  pressedRefresh: true,
  duplicateAnnouncement: true,
  refreshColor: "#7dd3fc"
};

export function makeSampleBatch(): BatchInput {
  const toBuild = (spec: BuildSpec, focusPath: readonly (string | undefined)[]): BuildInput => ({
    id: spec.id,
    label: spec.label,
    fingerprint: spec.fingerprint,
    frames: buildFrames(spec, [...focusPath])
  });
  return {
    schemaVersion: "1",
    operations: OPERATIONS.map((op) => ({ ...op })),
    baseline: toBuild(BASELINE_SPEC, BASELINE_FOCUS),
    candidate: toBuild(CANDIDATE_SPEC, CANDIDATE_FOCUS)
  };
}
