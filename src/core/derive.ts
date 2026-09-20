import type {
  Announcement, AxNode, AxStates, BuildInput, BuildFrameView, DomNode,
  Frame, KeyOp, NodeSignature
} from "./types";

export interface FlatDom {
  node: DomNode;
  parentId?: string;
  /** Ancestors ordered root -> parent, crossing shadow boundaries transparently. */
  ancestors: string[];
  inShadow: boolean;
  /** DOM order index within the frame. */
  order: number;
}

export interface FrameModel {
  index: number;
  flat: Map<string, FlatDom>;
  order: string[];
  axByDom: Map<string, AxNode>;
  axById: Map<string, AxNode>;
  signatures: Map<string, NodeSignature>;
  orderedReachable: string[];
  modalRootId?: string;
  observedFocusTo?: string;
  announcements: Announcement[];
  expectedFocusTo?: string;
  focusMovedUnexpectedly: boolean;
}

const ROLE_BY_TAG: Record<string, string> = {
  a: "link",
  button: "button",
  dialog: "dialog",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "img",
  input: "textbox",
  label: "label",
  li: "listitem",
  main: "main",
  menu: "menu",
  menuitem: "menuitem",
  nav: "navigation",
  ol: "list",
  output: "status",
  select: "combobox",
  textarea: "textbox",
  ul: "list"
};

const FOCUSABLE_ROLES = new Set([
  "button", "link", "textbox", "combobox", "checkbox", "radio", "menuitem",
  "menuitemcheckbox", "menuitemradio", "tab", "switch", "option", "slider",
  "spinbutton", "searchbox"
]);

const LAYER_ROLES = new Set([
  "dialog", "alertdialog", "menu", "menubar", "listbox", "grid", "tree",
  "popover", "tooltip"
]);

const SEMANTIC_ATTRS = [
  "aria-checked", "aria-disabled", "aria-expanded", "aria-haspopup",
  "aria-hidden", "aria-label", "aria-labelledby", "aria-live",
  "aria-modal", "aria-pressed", "aria-readonly", "aria-required",
  "aria-selected", "data-gsb-id", "href", "role", "tabindex", "type",
  "value"
];

export function flattenDom(root: DomNode): { flat: Map<string, FlatDom>; order: string[] } {
  const flat = new Map<string, FlatDom>();
  const order: string[] = [];
  let seq = 0;
  const walk = (node: DomNode, ancestors: string[], parentId: string | undefined, inShadow: boolean) => {
    flat.set(node.id, { node, parentId, ancestors: [...ancestors], inShadow, order: seq++ });
    order.push(node.id);
    const nextAncestors = [...ancestors, node.id];
    for (const child of node.children ?? []) {
      walk(child, nextAncestors, node.id, node.shadowHost ? true : inShadow);
    }
  };
  walk(root, [], undefined, false);
  return { flat, order };
}

function attr(node: DomNode, name: string): string | undefined {
  return node.attrs?.[name];
}

function isTruthyAttr(value: string | undefined): boolean {
  return value !== undefined && value !== "false";
}

export function resolveRole(node: DomNode): string {
  const explicit = attr(node, "role");
  if (explicit) return explicit.split(/\s+/)[0]!;
  if (node.tag === "input") {
    const type = attr(node, "type") ?? "text";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    return "textbox";
  }
  if (attr(node, "aria-live") === "polite" && node.tag === "div") return "status";
  if (isTruthyAttr(attr(node, "popover"))) return "popover";
  return ROLE_BY_TAG[node.tag] ?? "generic";
}

function resolveTabindex(node: DomNode, role: string, ax?: AxNode): number | undefined {
  if (ax?.states?.tabindex !== undefined) return ax.states.tabindex;
  const raw = attr(node, "tabindex");
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const tagDefault: Record<string, boolean> = {
    a: attr(node, "href") !== undefined,
    button: true,
    input: true,
    select: true,
    textarea: true
  };
  if (tagDefault[node.tag]) return 0;
  if (FOCUSABLE_ROLES.has(role)) return 0;
  return undefined;
}

function resolveHidden(node: DomNode, ax?: AxNode): boolean {
  if (ax?.states?.hidden) return true;
  const ariaHidden = attr(node, "aria-hidden");
  if (ariaHidden === "true") return true;
  if (attr(node, "hidden") !== undefined) return true;
  if (attr(node, "style")?.includes("display:none")) return true;
  if (attr(node, "style")?.includes("visibility:hidden")) return true;
  return false;
}

function resolveDisabled(node: DomNode, ax?: AxNode): boolean {
  if (ax?.states?.disabled) return true;
  if (attr(node, "disabled") !== undefined) return true;
  if (attr(node, "aria-disabled") === "true") return true;
  return false;
}

function collectText(node: DomNode): string {
  const own = node.text?.trim();
  const childTexts: string[] = [];
  const walk = (n: DomNode) => {
    for (const child of n.children ?? []) {
      if (child.text?.trim()) childTexts.push(child.text.trim());
      walk(child);
    }
  };
  walk(node);
  return [own, ...childTexts].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function resolveName(node: DomNode, role: string, ax: AxNode | undefined, flat: Map<string, FlatDom>): string {
  if (ax?.name !== undefined) return ax.name;
  const labelledby = ax?.states?.labelledby ?? attr(node, "aria-labelledby");
  if (labelledby) {
    const texts = labelledby.split(/\s+/).map((id) => flat.get(id)?.node.text?.trim()).filter(Boolean);
    if (texts.length) return texts.join(" ");
  }
  const ariaLabel = attr(node, "aria-label");
  if (ariaLabel) return ariaLabel.trim();
  if (node.tag === "img") return attr(node, "alt")?.trim() ?? "";
  if (node.tag === "input") {
    const labelled = findLabelText(node, flat);
    if (labelled) return labelled;
  }
  if (node.tag === "a" || node.tag === "button" || FOCUSABLE_ROLES.has(role) || role === "heading") {
    return collectText(node);
  }
  return node.text?.trim() ?? "";
}

function findLabelText(node: DomNode, flat: Map<string, FlatDom>): string | undefined {
  const id = node.id;
  for (const { node: candidate } of flat.values()) {
    if (candidate.tag === "label" && candidate.attrs?.for === id) {
      return candidate.text?.trim();
    }
  }
  const parent = flat.get(node.id)?.parentId;
  if (parent) {
    const parentNode = flat.get(parent)?.node;
    if (parentNode?.tag === "label") return parentNode.text?.trim();
  }
  return undefined;
}

function flag(value: boolean | undefined): boolean {
  return value === true;
}

function buildSignatures(flat: Map<string, FlatDom>, axByDom: Map<string, AxNode>): Map<string, NodeSignature> {
  const result = new Map<string, NodeSignature>();
  for (const [id, entry] of flat) {
    const node = entry.node;
    const ax = axByDom.get(id);
    const role = ax?.role ?? resolveRole(node);
    const name = resolveName(node, role, ax, flat);
    const tabindex = resolveTabindex(node, role, ax);
    const ancestorHidden = entry.ancestors.some((ancestorId) => {
      const ancestor = flat.get(ancestorId)!;
      return resolveHidden(ancestor.node, axByDom.get(ancestorId));
    });
    const ownHidden = resolveHidden(node, ax);
    const ownRole = ax?.role ?? role;
    // A layer container's own visibility is owned by its explicit AX state;
    // descendants still inherit the container's hidden attribute.
    const hidden = LAYER_ROLES.has(ownRole) ? ownHidden : ownHidden || ancestorHidden;
    const disabled = resolveDisabled(node, ax);
    const states = ax?.states ?? {};
    const visible = !hidden && (states.visible !== false);
    const focusable = tabindex !== undefined && !hidden && !disabled;
    const ancestorContext = entry.ancestors
      .map((ancestorId) => {
        const ancestorFlat = flat.get(ancestorId)!;
        const ancestorAx = axByDom.get(ancestorId);
        return {
          role: ancestorAx?.role ?? resolveRole(ancestorFlat.node),
          name: resolveName(ancestorFlat.node, ancestorAx?.role ?? resolveRole(ancestorFlat.node), ancestorAx, flat)
        };
      })
      .filter((ctx) => ctx.role !== "generic" || ctx.name !== "");
    result.set(id, {
      domId: id,
      axId: ax?.id,
      role,
      name,
      ancestorContext,
      inShadow: entry.inShadow,
      tabReachable: focusable && (tabindex ?? 0) >= 0 && visible,
      focusable,
      visible,
      states: {
        disabled,
        hidden,
        selected: flag(states.selected) || attr(node, "aria-selected") === "true",
        checked: flag(states.checked) || ["true", "mixed"].includes(attr(node, "aria-checked") ?? ""),
        expanded: flag(states.expanded) || attr(node, "aria-expanded") === "true",
        pressed: flag(states.pressed) || attr(node, "aria-pressed") === "true",
        readonly: flag(states.readonly) || attr(node, "aria-readonly") === "true",
        required: flag(states.required) || attr(node, "aria-required") === "true",
        modal: flag(states.modal) || isTruthyAttr(attr(node, "aria-modal")),
        live: (states.live as NodeSignature["states"]["live"]) ?? liveFromAttr(node)
      }
    });
  }
  return result;
}

function liveFromAttr(node: DomNode): "off" | "polite" | "assertive" {
  const value = attr(node, "aria-live");
  if (value === "polite" || value === "assertive") return value;
  return "off";
}

function findModalRoot(signatures: Map<string, NodeSignature>, flat: Map<string, FlatDom>): string | undefined {
  for (const [id, sig] of signatures) {
    if (!sig.states.modal || !sig.visible) continue;
    if (LAYER_ROLES.has(sig.role) && sig.role !== "tooltip") return id;
  }
  return undefined;
}

function isDescendantOf(flat: Map<string, FlatDom>, id: string, ancestorId: string): boolean {
  return flat.get(id)?.ancestors.includes(ancestorId) ?? false;
}

export function tabOrder(model: {
  signatures: Map<string, NodeSignature>;
  flat: Map<string, FlatDom>;
  order: string[];
  modalRootId?: string;
}): string[] {
  const positives: { id: string; index: number }[] = [];
  const zero: string[] = [];
  for (const id of model.order) {
    const sig = model.signatures.get(id)!;
    if (!sig.tabReachable) continue;
    if (model.modalRootId && id !== model.modalRootId && !isDescendantOf(model.flat, id, model.modalRootId)) {
      continue;
    }
    const raw = model.flat.get(id)!.node.attrs?.tabindex;
    const tabindex = raw !== undefined ? Number.parseInt(raw, 10) : 0;
    if (tabindex > 0) positives.push({ id, index: tabindex });
    else zero.push(id);
  }
  positives.sort((a, b) => (a.index - b.index) || (model.flat.get(a.id)!.order - model.flat.get(b.id)!.order));
  return [...positives.map((entry) => entry.id), ...zero];
}

export function buildFrameModel(frame: Frame): FrameModel {
  const { flat, order } = flattenDom(frame.dom);
  const axByDom = new Map<string, AxNode>();
  const axById = new Map<string, AxNode>();
  for (const ax of frame.ax) {
    axById.set(ax.id, ax);
    if (ax.domId) {
      if (axByDom.has(ax.domId)) {
        throw new Error(`frame ${frame.index}: duplicate ax node bound to domId ${ax.domId}`);
      }
      axByDom.set(ax.domId, ax);
    }
  }
  const signatures = buildSignatures(flat, axByDom);
  const modalRootId = findModalRoot(signatures, flat);
  const orderedReachable = tabOrder({ signatures, flat, order, modalRootId });
  const observedFocusTo = frame.focus?.to ?? findAxFocused(axByDom);
  return {
    index: frame.index,
    flat,
    order,
    axByDom,
    axById,
    signatures,
    orderedReachable,
    modalRootId,
    observedFocusTo,
    announcements: [...(frame.announcements ?? [])],
    expectedFocusTo: undefined,
    focusMovedUnexpectedly: false
  };
}

function findAxFocused(axByDom: Map<string, AxNode>): string | undefined {
  for (const [domId, ax] of axByDom) {
    if (ax.states?.focused) return domId;
  }
  return undefined;
}

export function applyKey(
  op: KeyOp,
  current: FrameModel,
  previous: FrameModel | undefined
): { expectedFocusTo?: string; focusMovedUnexpectedly: boolean } {
  const previousFocus = previous?.observedFocusTo;
  let expected: string | undefined;
  if (op.type === "Tab") {
    const order = current.orderedReachable;
    const triggerEntry = previousFocus ? layerEntryFromTrigger(current, previousFocus) : undefined;
    const fromIndex = previousFocus ? order.indexOf(previousFocus) : -1;
    expected = order[fromIndex + 1];
    // Tab from a popup trigger (aria-controls) enters the open layer first.
    const layerEntry = triggerEntry ?? firstReachableOfNewLayer(previous, current);
    if (layerEntry) expected = layerEntry;
  } else if (op.type === "ShiftTab") {
    const order = current.orderedReachable;
    const triggerEntry = previousFocus ? layerEntryFromTrigger(current, previousFocus) : undefined;
    const fromIndex = previousFocus ? order.indexOf(previousFocus) : -1;
    expected = fromIndex >= 1 ? order[fromIndex - 1] : undefined;
    const layerEntry = triggerEntry ?? firstReachableOfNewLayer(previous, current);
    if (layerEntry) expected = layerEntry;
  } else if (op.type === "Escape") {
    // Closing a layer restores focus by design; the observed restoration
    // target is the semantic expectation and is not a focus skip.
    expected = current.observedFocusTo ?? previousFocus;
  } else {
    expected = previousFocus ?? current.observedFocusTo;
  }
  const observed = current.observedFocusTo;
  return {
    expectedFocusTo: expected,
    focusMovedUnexpectedly: observed !== undefined && expected !== undefined && observed !== expected
  };
}

function firstReachableOfNewLayer(previous: FrameModel | undefined, current: FrameModel): string | undefined {
  if (!previous) return undefined;
  for (const id of current.order) {
    const sig = current.signatures.get(id)!;
    if (!sig.visible || !layerRole(sig.role)) continue;
    const prevSig = previous.signatures.get(id);
    if (prevSig && prevSig.visible && layerRole(prevSig.role)) continue;
    const inside = current.orderedReachable.find((reachableId) =>
      reachableId !== id && (current.flat.get(reachableId)?.ancestors.includes(id) ?? false)
    );
    if (inside) return inside;
  }
  return undefined;
}

export function buildFrameViews(build: BuildInput, operations: KeyOp[]): FrameModel[] {
  const models = build.frames.map((frame) => buildFrameModel(frame));
  for (let i = 0; i < models.length; i++) {
    if (i === 0) continue;
    const op = operations[i - 1]!;
    const result = applyKey(op, models[i]!, models[i - 1]);
    models[i]!.expectedFocusTo = result.expectedFocusTo;
    models[i]!.focusMovedUnexpectedly = result.focusMovedUnexpectedly;
  }
  return models;
}

export function toBuildFrameView(model: FrameModel): BuildFrameView {
  const signatures: Record<string, NodeSignature> = {};
  for (const [id, sig] of model.signatures) signatures[id] = sig;
  return {
    orderedReachable: [...model.orderedReachable],
    expectedFocusTo: model.expectedFocusTo,
    observedFocusTo: model.observedFocusTo,
    focusMovedUnexpectedly: model.focusMovedUnexpectedly,
    signatures,
    announcements: [...model.announcements]
  };
}

export function layerRole(role: string): boolean {
  return LAYER_ROLES.has(role);
}

export function semanticAttributes(node: DomNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SEMANTIC_ATTRS) {
    const value = node.attrs?.[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export type { AxStates };

function layerEntryFromTrigger(model: FrameModel, focusId: string | undefined): string | undefined {
  if (!focusId) return undefined;
  const trigger = model.flat.get(focusId)?.node;
  const controls = trigger?.attrs?.["aria-controls"];
  if (!controls) return undefined;
  const layerSig = model.signatures.get(controls);
  if (!layerSig || !layerSig.visible || !layerRole(layerSig.role)) return undefined;
  if (focusId === controls || (model.flat.get(focusId)?.ancestors.includes(controls) ?? false)) return undefined;
  return model.orderedReachable.find((id) =>
    id !== controls && (model.flat.get(id)?.ancestors.includes(controls) ?? false)
  );
}
