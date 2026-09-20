/**
 * Input/output contract for the pair-wise keyboard/AT semantic workbench.
 *
 * Everything here is plain serializable data. The engine never observes a live
 * browser: a run is a pure function of the imported DOM snapshots, accessibility
 * trees, focus events, keyboard sequence and the pinned rule version.
 */

export const RULE_VERSION = "1.0.0";
export const SCHEMA_VERSION = "1";

export type Severity = "blocker" | "major" | "minor";

/** A raw DOM node as imported from a snapshot. */
export interface DomNode {
  id: string;
  tag: string;
  attrs?: Record<string, string>;
  /** Plain text content or accessible text carried by the element itself. */
  text?: string;
  /** True when this node hosts an open shadow root; children are shadow DOM. */
  shadowHost?: boolean;
  /** Children rendered inside a shadow tree when true. */
  shadowChildren?: boolean;
  children?: DomNode[];
}

/** An accessibility-tree node. Linked to the DOM via domId. */
export interface AxNode {
  id: string;
  domId?: string;
  role: string;
  name?: string;
  states?: AxStates;
  children?: string[];
}

export interface AxStates {
  disabled?: boolean;
  hidden?: boolean;
  focused?: boolean;
  selected?: boolean;
  checked?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  readonly?: boolean;
  required?: boolean;
  /** Popover/dialog/live region that is currently rendered. */
  visible?: boolean;
  modal?: boolean;
  live?: "off" | "polite" | "assertive";
  /** DOM id referenced by aria-labelledby. */
  labelledby?: string;
  /** Tab index as it would resolve in the browser; -1 = focusable only. */
  tabindex?: number;
}

export interface Announcement {
  regionId?: string;
  text: string;
  polite?: boolean;
}

export interface FocusEvent {
  from?: string;
  to?: string;
  /** "default" Tab, "reverse" Shift+Tab, plus activation keys. */
  action?: "default" | "reverse" | "activate";
}

/**
 * A frame is the observed state immediately after applying step (frameIndex-1).
 * Frame 0 is the initial state. Builds therefore provide steps.length + 1 frames.
 */
export interface Frame {
  /** Index within the build; required so sparse authored JSON stays aligned. */
  index: number;
  /** Full or patched DOM snapshot for this frame. */
  dom: DomNode;
  /** Full accessibility tree for this frame. */
  ax: AxNode[];
  focus?: FocusEvent;
  announcements?: Announcement[];
}

export type KeyOpType =
  | "Tab"
  | "ShiftTab"
  | "Enter"
  | "Space"
  | "ArrowDown"
  | "ArrowUp"
  | "ArrowLeft"
  | "ArrowRight"
  | "Escape";

export interface KeyOp {
  type: KeyOpType;
  label?: string;
}

export interface BuildInput {
  id: string;
  label: string;
  /** Fingerprint identifying the local build (commit hash, build id, ...). */
  fingerprint: string;
  frames: Frame[];
}

export interface BatchInput {
  schemaVersion?: string;
  operations: KeyOp[];
  baseline: BuildInput;
  candidate: BuildInput;
  /** Optional client-created clock; the engine never reads the system clock. */
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export type MatchConfidence = "exact" | "high" | "medium" | "none";

export interface NodeSignature {
  domId: string;
  axId?: string;
  role: string;
  name: string;
  ancestorContext: { role: string; name: string }[];
  inShadow: boolean;
  tabReachable: boolean;
  focusable: boolean;
  states: Required<Pick<AxStates,
    "disabled" | "hidden" | "selected" | "checked" | "expanded" |
    "pressed" | "readonly" | "required" | "modal" | "live">>;
  visible: boolean;
}

export interface NodeMatch {
  baselineDomId?: string;
  candidateDomId?: string;
  role: string;
  name: string;
  confidence: MatchConfidence;
  score: number;
  evidence: {
    stableId: boolean;
    role: boolean;
    name: boolean;
    ancestors: number;
    attrSignature: boolean;
  };
}

export type FindingKind =
  | "focus-destination"
  | "reachable-set"
  | "semantic-state"
  | "focus-trap"
  | "unreachable-popover"
  | "duplicate-announcement";

export type FindingScope = "cross-build" | "build-specific";

export interface ReplayEvidence {
  /** Key steps that produce the finding, as indices into the operation list. */
  operationIndices: number[];
  frameIndices: number[];
  /** Ordered focus target domIds observed while replaying. */
  focusPath: string[];
  /** Ordered tab-reachable domIds at the trap container / popup frame. */
  tabOrder?: string[];
  /** Announcement texts involved (used by duplicate-announcement). */
  announcements?: string[];
  detail: string;
}

export interface Finding {
  id: string;
  kind: FindingKind;
  scope: FindingScope;
  severity: Severity;
  frameIndex: number;
  operationIndex?: number;
  subjectDomId?: string;
  subjectBuild?: "baseline" | "candidate";
  matchedDomIds?: { baseline?: string; candidate?: string };
  summary: string;
  evidence: ReplayEvidence;
}

export interface FrameReport {
  index: number;
  baseline: BuildFrameView;
  candidate: BuildFrameView;
  matches: NodeMatch[];
}

export interface BuildFrameView {
  orderedReachable: string[];
  expectedFocusTo?: string;
  observedFocusTo?: string;
  focusMovedUnexpectedly: boolean;
  signatures: Record<string, NodeSignature>;
  announcements: Announcement[];
}

export interface BuildReport {
  id: string;
  label: string;
  fingerprint: string;
  frames: BuildFrameView[];
  findings: Finding[];
}

export interface RunReport {
  ruleVersion: string;
  schemaVersion: string;
  batchId: string;
  inputFingerprint: string;
  operations: KeyOp[];
  baseline: BuildReport;
  candidate: BuildReport;
  /** Per-frame matched signature pairs plus added/remounted/removed sets. */
  frameReports: FrameReport[];
  /** Findings aligned across builds by semantic identity where possible. */
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Decisions (human overlay, append-only)
// ---------------------------------------------------------------------------

export type Classification = "defect" | "intentional" | "noise";

export interface DecisionEvent {
  id: string;
  seq: number;
  type: "classify" | "undo";
  at?: string;
  operator: string;
  reason: string;
  findingId?: string;
  classification?: Classification;
  scope?: ExemptionScope;
  /** Key of the decision event this event revokes. */
  revokes?: string;
  /** Snapshot of scope validity evaluated when the event was written. */
  validity?: DecisionValidity;
}

export interface ExemptionScope {
  buildId: string;
  buildFingerprint: string;
  role: string;
  accessibleName: string;
  ancestorContext: { role: string; name: string }[];
  frameIndex: number;
  findingKind: FindingKind;
}

export interface DecisionValidity {
  status: "active" | "invalid-fingerprint" | "invalid-subject" | "revoked";
  reasons: string[];
}

export interface FindingDecisionState {
  findingId: string;
  classifications: {
    classification: Classification;
    count: number;
    researchers: string[];
  }[];
  conflict: boolean;
  exemption?: {
    scope: ExemptionScope;
    validity: DecisionValidity;
    operator: string;
    reason: string;
  };
  history: DecisionEvent[];
}

export interface StoredBatch {
  batchId: string;
  input: BatchInput;
  report: RunReport;
  events: DecisionEvent[];
  createdAt?: string;
}

export interface ExportBundle {
  schemaVersion: string;
  ruleVersion: string;
  exportedAt?: string;
  input: BatchInput;
  report: RunReport;
  matchMapping: { frameIndex: number; matches: NodeMatch[] }[];
  decisions: DecisionEvent[];
  checksums: {
    input: string;
    report: string;
  };
}
