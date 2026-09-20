/**
 * Domain types for the pair-wise keyboard / assistive-technology comparison
 * workbench. Everything in this file is plain serializable JSON: an analysis
 * result must be reproducible from the saved input and the rule version alone.
 */

export const RULE_VERSION = 'rules-2026-09-21.1';

export type BuildSide = 'baseline' | 'candidate';

export type AriaRole =
  | string
  | 'button'
  | 'link'
  | 'checkbox'
  | 'textbox'
  | 'combobox'
  | 'listbox'
  | 'option'
  | 'dialog'
  | 'alertdialog'
  | 'menu'
  | 'menuitem'
  | 'tab'
  | 'tablist'
  | 'radio'
  | 'switch'
  | 'slider'
  | 'navigation'
  | 'main'
  | 'heading'
  | 'alert'
  | 'status'
  | 'tooltip'
  | 'group'
  | 'presentation'
  | 'none';

/** Visual / DOM node of an imported snapshot. Stable identifiers are explicit. */
export interface DomNodeInput {
  /** Stable identity declared by the importer (test id, framework id...). */
  stableId?: string;
  tag: string;
  role?: AriaRole;
  accessibleName?: string;
  /** ids referenced by aria-labelledby / aria-describedby. */
  labelledby?: string[];
  describedby?: string[];
  /** Explicit DOM id; never treated as identity on its own. */
  id?: string;
  testid?: string;
  /** The element controls another element (aria-controls target stableId/id). */
  controls?: string;
  tabindex?: number;
  focusable?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Visually rendered but removed from the accessibility tree. */
  ariaHidden?: boolean;
  live?: 'polite' | 'assertive' | 'off';
  /** Rendered text used for name computation and live announcements. */
  text?: string;
  /** aria-checked / pressed / expanded / selected / readonly / required ... */
  states?: Record<string, string | boolean>;
  /** Marks a shadow host; children are flattened light+shadow DOM. */
  shadowHost?: boolean;
  children?: DomNodeInput[];
}

export interface A11yNodeInput {
  /** Reference to the DOM node (stableId preferred, then DOM id, then preorder key). */
  domRef: string;
  role: AriaRole;
  name?: string;
  states?: Record<string, string | boolean>;
  focusable?: boolean;
  ignored?: boolean;
}

/** A focus transition captured during the recorded keyboard session. */
export interface FocusEventInput {
  fromRef?: string;
  toRef?: string;
  /** null means focus moved to body / nothing. */
  reason?: string;
}

/** Imported assistive-technology announcement (optional ground truth). */
export interface AnnouncementInput {
  targetRef?: string;
  polite?: boolean;
  text: string;
}

export interface StepInput {
  /** 0-based position; must be dense across a build. */
  index: number;
  /** The keyboard action applied at this step, e.g. {"key":"Tab"}. */
  action: Record<string, string | number | boolean>;
  dom: DomNodeInput;
  a11y?: A11yNodeInput[];
  focus?: FocusEventInput;
  announcements?: AnnouncementInput[];
}

export interface BuildInput {
  side: BuildSide;
  /** Build fingerprint (commit hash / bundle id). Bound into exemptions. */
  fingerprint: string;
  label?: string;
  steps: StepInput[];
}

export interface CompareRequestInput {
  ruleVersion?: string;
  baseline: BuildInput;
  candidate: BuildInput;
}

/* ------------------------------------------------------------------ */

export interface FlatDomNode {
  key: string;
  preorder: number;
  parentKey: string | null;
  stableId: string | null;
  tag: string;
  role: AriaRole;
  name: string;
  id: string | null;
  testid: string | null;
  controls: string | null;
  tabindex: number | null;
  focusable: boolean;
  disabled: boolean;
  hidden: boolean;
  ariaHidden: boolean;
  live: 'polite' | 'assertive' | 'off' | null;
  text: string;
  states: Record<string, string | boolean>;
  shadowHost: boolean;
}

export interface FlatA11yNode {
  domKey: string;
  role: AriaRole;
  name: string;
  states: Record<string, string | boolean>;
  focusable: boolean;
  ignored: boolean;
}

export interface FocusEvent {
  fromKey: string | null;
  toKey: string | null;
  reason: string;
}

export interface Announcement {
  targetKey: string | null;
  polite: boolean;
  text: string;
}

export interface ReplayStep {
  index: number;
  action: Record<string, string | number | boolean>;
  nodes: FlatDomNode[];
  byKey: Record<string, FlatDomNode>;
  a11y: FlatA11yNode[];
  a11yByKey: Record<string, FlatA11yNode>;
  /** Preorder keys of keyboard-reachable (tabbable) nodes. */
  tabOrder: string[];
  /** Preorder keys exposed to assistive technology. */
  a11yReachable: string[];
  /** Live regions present at this step (key -> text). */
  liveRegions: Record<string, string>;
  focus: FocusEvent | null;
  announcements: Announcement[];
  /** Nodes with dialog/popup-like role that are visible at the step. */
  openPopups: string[];
  fingerprint: string;
}

export interface ReplayedBuild {
  side: BuildSide;
  fingerprint: string;
  label: string;
  steps: ReplayStep[];
}

/* ----------------------------- matching ---------------------------- */

export type Confidence = 'high' | 'medium' | 'low';

export interface MatchEvidence {
  stableId: boolean;
  testid: boolean;
  domId: boolean;
  role: boolean;
  name: boolean;
  controls: boolean;
  ancestor: number;
  score: number;
  confidence: Confidence;
}

export interface NodeMatch {
  baselineKey: string;
  candidateKey: string;
  evidence: MatchEvidence;
}

export interface StepMapping {
  stepIndex: number;
  matches: NodeMatch[];
  /** Candidate keys with no acceptable baseline counterpart. */
  added: string[];
  /** Baseline keys with no acceptable candidate counterpart. */
  removed: string[];
}

/* ----------------------------- findings ---------------------------- */

export type FindingCode =
  | 'focus-trap'
  | 'unreachable-popup'
  | 'live-repeat';

export interface Finding {
  code: FindingCode;
  stepIndex: number;
  /** Stable signature used for baseline-vs-candidate comparison. */
  signature: string;
  message: string;
  evidence: Record<string, unknown>;
}

/* --------------------------- divergences --------------------------- */

export type DivergenceKind =
  | 'focus-destination'
  | 'reachable-set'
  | 'semantic-state'
  | 'finding'
  | 'new-node'
  | 'gone-node';

export interface Divergence {
  id: string;
  stepIndex: number;
  kind: DivergenceKind;
  subjectKey: string;
  role: string;
  name: string;
  /** Ancestor chain (role/name/stableId), nearest first. */
  ancestorContext: string[];
  baseline: Record<string, unknown>;
  candidate: Record<string, unknown>;
  baselineFingerprint: string;
  candidateFingerprint: string;
  detail: string;
}

export interface ComparisonResult {
  ruleVersion: string;
  baselineFingerprint: string;
  candidateFingerprint: string;
  baseline: ReplayedBuild;
  candidate: ReplayedBuild;
  mappings: StepMapping[];
  findings: { baseline: Finding[]; candidate: Finding[] };
  divergences: Divergence[];
  earliestStep: number | null;
  /** Fingerprint of inputs+rule, used to bind decisions to this comparison. */
  inputFingerprint: string;
}

/* ---------------------------- decisions ---------------------------- */

export type DecisionKind = 'intentional' | 'regression';

export type DecisionEventType = 'classified' | 'exempted' | 'undone';

export interface DecisionEvent {
  seq: number;
  id: string;
  type: DecisionEventType;
  divergenceId: string;
  kind?: DecisionKind;
  reason: string;
  operator: string;
  /** Inclusive step range for an exemption. */
  rangeStart?: number;
  rangeEnd?: number;
  binding?: ExemptionBinding;
  /** seq of the event being undone (undo events are append-only). */
  undoesSeq?: number;
  beforeVersion: string | null;
  afterVersion: string;
  inputFingerprint: string;
  ruleVersion: string;
  /** Present only when explicitly supplied; never read from the wall clock. */
  clientTime?: string;
}

export interface ExemptionBinding {
  role: string;
  accessibleName: string;
  ancestorContext: string[];
  /** Both sides are snapshotted so either side moving/renaming invalidates. */
  baselineRole: string;
  candidateRole: string;
  baselineName: string;
  candidateName: string;
  baselineAncestorContext: string[];
  candidateAncestorContext: string[];
  baselineFingerprint: string;
  candidateFingerprint: string;
  ruleVersion: string;
  subjectKey: string;
  stepIndex: number;
}

export type ExemptionStatus = 'active' | 'invalid';
export type InvalidationReason =
  | 'node-moved'
  | 'name-changed'
  | 'role-changed'
  | 'fingerprint-changed'
  | 'out-of-range';

export interface ExemptionView {
  eventId: string;
  divergenceId: string;
  operator: string;
  reason: string;
  rangeStart: number;
  rangeEnd: number;
  binding: ExemptionBinding;
  status: ExemptionStatus;
  invalidReason: InvalidationReason | null;
}

export type ClassificationStatus =
  | 'unclassified'
  | 'intentional'
  | 'regression'
  | 'conflict';

export interface DivergenceDecisionView {
  divergenceId: string;
  status: ClassificationStatus;
  /** All non-undone classifications, newest last. */
  classifications: { operator: string; kind: DecisionKind; reason: string; eventId: string }[];
  conflict: boolean;
  activeExemptions: ExemptionView[];
}

export interface DecisionLedger {
  inputFingerprint: string;
  ruleVersion: string;
  events: DecisionEvent[];
  version: string | null;
}

export interface DecisionProjection {
  version: string | null;
  views: Record<string, DivergenceDecisionView>;
  exemptions: ExemptionView[];
}

/* ------------------------------ batch ------------------------------ */

export interface BatchOperation {
  divergenceId: string;
  type: 'classified' | 'exempted';
  kind?: DecisionKind;
  reason: string;
  operator: string;
  rangeStart?: number;
  rangeEnd?: number;
  clientTime?: string;
}

/* ------------------------------ export ----------------------------- */

export interface ExportPackage {
  format: 'pairwise-gsb-export';
  formatVersion: 1;
  ruleVersion: string;
  inputFingerprint: string;
  request: CompareRequestInput;
  result: {
    mappings: StepMapping[];
    findings: { baseline: Finding[]; candidate: Finding[] };
    divergences: Divergence[];
    earliestStep: number | null;
    replayOrder: {
      baseline: string[][];
      candidate: string[][];
    };
  };
  ledger: DecisionLedger;
  createdAt: string | null;
}
