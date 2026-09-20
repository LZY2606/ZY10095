/**
 * Rule detectors for replayable accessibility evidence.
 *
 * Each finding carries a stable signature so the same condition in both
 * builds is not a divergence, while a condition present on only one side is.
 * Visual color changes are intentionally not modeled: rules operate on
 * operable paths and semantic state only.
 */

import type { Finding, ReplayedBuild, ReplayStep } from './types.js';
import { compareStrings, hashString } from './deterministic.js';
import { hasHiddenAncestor, subtreeTextOfFlat } from './replay.js';

const LIVE_REPEAT_WINDOW = 3;

const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);

export function detectFindings(build: ReplayedBuild): Finding[] {
  const findings: Finding[] = [];
  for (const step of build.steps) {
    findings.push(...detectFocusTraps(build, step));
    findings.push(...detectUnreachablePopups(build, step));
    findings.push(...detectLiveRepeats(build, step));
  }
  findings.sort((a, b) => {
    const sig = compareStrings(a.signature, b.signature);
    return sig !== 0 ? sig : a.stepIndex - b.stepIndex;
  });
  return dedupeBySignature(findings);
}

function dedupeBySignature(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of findings) {
    if (!seen.has(finding.signature)) {
      seen.add(finding.signature);
      out.push(finding);
    }
  }
  return out;
}

function dialogKeys(step: ReplayStep): string[] {
  return step.openPopups.filter((key) =>
    DIALOG_ROLES.has(step.a11yByKey[key]?.role ?? step.byKey[key]?.role ?? ''),
  );
}

/**
 * Focus trap evidence: while a dialog is open, focus stays inside it for the
 * whole session and at least one tabbable node exists outside it. A dialog
 * with zero focusable descendants is reported as a dead trap (focus cannot
 * move at all).
 */
function detectFocusTraps(build: ReplayedBuild, step: ReplayStep): Finding[] {
  const out: Finding[] = [];
  for (const dialogKey of dialogKeys(step)) {
    const dialog = step.byKey[dialogKey]!;
    const focusablesInside = step.tabOrder.filter((key) =>
      isInside(step, key, dialogKey),
    );
    const focusablesOutside = step.tabOrder.filter(
      (key) => !isInside(step, key, dialogKey),
    );
    const whileOpen = build.steps.filter((entry) =>
      entry.openPopups.includes(dialogKey),
    );
    const focusStaysInside = whileOpen.every((entry) => {
      const to = entry.focus?.toKey;
      if (!to) {
        return false;
      }
      return isInside(entry, to, dialogKey);
    });

    const trapped =
      focusablesOutside.length > 0 &&
      focusablesInside.length > 0 &&
      focusStaysInside &&
      !isModal(dialog);
    const dead = focusablesInside.length === 0;

    if (trapped || dead) {
      const variant = trapped ? 'contained' : 'dead';
      out.push({
        code: 'focus-trap',
        stepIndex: step.index,
        signature: hashString(
          `focus-trap|${dialog.role}|${dialog.name}|${variant}`,
        ),
        message: trapped
          ? `Focus is trapped inside dialog "${dialog.name}" while ${focusablesOutside.length} tabbable nodes remain outside.`
          : `Dialog "${dialog.name}" opened with no focusable node: focus cannot move.`,
        evidence: {
          dialogKey,
          role: dialog.role,
          name: dialog.name,
          variant,
          focusablesInside: focusablesInside.sort(compareStrings),
          focusablesOutside: focusablesOutside.sort(compareStrings),
          observedFocus: whileOpen.map((entry) => ({
            stepIndex: entry.index,
            toKey: entry.focus?.toKey ?? null,
          })),
        },
      });
    }
  }
  return out;
}

function isModal(node: { states: Record<string, string | boolean> }): boolean {
  return node.states.modal === true || node.states.modal === 'true';
}

/**
 * Unreachable popup: a visible dialog/popup never contains a tabbable node
 * and focus never moves into it while it is open.
 */
function detectUnreachablePopups(build: ReplayedBuild, step: ReplayStep): Finding[] {
  const out: Finding[] = [];
  for (const popupKey of step.openPopups) {
    if (dialogKeys(step).includes(popupKey)) {
      continue; // dialogs are covered by the focus-trap rule
    }
    const popup = step.byKey[popupKey]!;
    const whileOpen = build.steps.filter((entry) =>
      entry.openPopups.includes(popupKey),
    );
    const reachableInside = step.tabOrder.some((key) =>
      isInside(step, key, popupKey),
    );
    const focusEntered = whileOpen.some((entry) => {
      const to = entry.focus?.toKey;
      return to ? isInside(entry, to, popupKey) : false;
    });
    if (!reachableInside && !focusEntered) {
      out.push({
        code: 'unreachable-popup',
        stepIndex: step.index,
        signature: hashString(
          `unreachable-popup|${popup.role}|${popup.name}`,
        ),
        message: `Popup "${popup.name}" is visible but has no keyboard path and never receives focus.`,
        evidence: {
          popupKey,
          role: popup.role,
          name: popup.name,
          openSteps: whileOpen.map((entry) => entry.index),
          tabOrder: step.tabOrder,
        },
      });
    }
  }
  return out;
}

/**
 * Live-region repeat: the same region announces identical text more than once
 * within a short rolling window (no content change between repeats).
 */
function detectLiveRepeats(build: ReplayedBuild, step: ReplayStep): Finding[] {
  const out: Finding[] = [];
  for (const announcement of step.announcements) {
    if (!announcement.targetKey) {
      continue;
    }
    const windowStart = Math.max(0, step.index - LIVE_REPEAT_WINDOW);
    const priorSteps = build.steps.slice(windowStart, step.index);
    const priorOccurrences = priorSteps
      .filter(
        (entry) =>
          entry.liveRegions[announcement.targetKey!] ===
            step.liveRegions[announcement.targetKey!] &&
          entry.announcements.some(
            (candidate) =>
              candidate.targetKey === announcement.targetKey &&
              candidate.text === announcement.text,
          ),
      )
      .map((entry) => entry.index);
    if (priorSteps.length === 0 || priorOccurrences.length === 0) {
      continue;
    }
    const region = step.byKey[announcement.targetKey]!;
    out.push({
      code: 'live-repeat',
      stepIndex: step.index,
      signature: hashString(`live-repeat|${region.role}|${announcement.text}`),
      message: `Live region "${region.name || region.role}" repeated "${announcement.text}" without a content change.`,
      evidence: {
        regionKey: announcement.targetKey,
        role: region.role,
        name: region.name,
        polite: announcement.polite,
        text: announcement.text,
        firstSteps: priorOccurrences.sort((a, b) => a - b),
        repeatedAtStep: step.index,
      },
    });
  }
  return out;
}

function isInside(step: ReplayStep, key: string, ancestorKey: string): boolean {
  let current = step.byKey[key];
  while (current) {
    if (current.key === ancestorKey) {
      return true;
    }
    current = current.parentKey ? step.byKey[current.parentKey] : undefined;
  }
  return false;
}

/** Rendered text snapshot of a subtree (used by the UI / tests for evidence). */
export function regionText(step: ReplayStep, key: string): string {
  const node = step.byKey[key];
  return node ? subtreeTextOfFlat(node, step.byKey) : '';
}

export function stepHasHiddenAncestor(
  step: ReplayStep,
  key: string,
): boolean {
  const node = step.byKey[key];
  return node ? hasHiddenAncestor(node, step.byKey) : true;
}
