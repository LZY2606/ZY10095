/**
 * Browser-side workbench state. The core library stays the source of truth;
 * this module only holds the current request/result/ledger and persists them
 * to localStorage so a reload resumes the same review.
 */

import {
  Workbench,
  type CompareRequestInput,
  type DecisionLedger,
} from '../core/index.js';
import { sampleRequest } from '../core/sample-data.js';

const STORAGE_KEY = 'pairwise-gsb-session-v1';

export interface UiState {
  request: CompareRequestInput | null;
  workbench: Workbench | null;
  selectedStep: number;
  selectedDivergence: string | null;
  operator: string;
  error: string | null;
}

export const state: UiState = {
  request: null,
  workbench: null,
  selectedStep: 0,
  selectedDivergence: null,
  operator: 'reviewer',
  error: null,
};

export function loadSampleRequest(): CompareRequestInput {
  return sampleRequest();
}

export function runComparison(request: CompareRequestInput, ledger?: DecisionLedger): void {
  state.request = request;
  state.workbench = new Workbench(request, ledger);
  state.selectedStep = state.workbench.result.earliestStep ?? 0;
  const first = state.workbench.result.divergences.find(
    (d) => d.stepIndex === state.selectedStep,
  );
  state.selectedDivergence = first?.id ?? null;
  state.error = null;
  persist();
}

export function persist(): void {
  if (!state.request || !state.workbench) {
    return;
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        request: state.request,
        ledger: state.workbench.ledger,
        operator: state.operator,
      }),
    );
  } catch {
    // Storage may be unavailable; the in-memory session still works.
  }
}

export function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as {
      request: CompareRequestInput;
      ledger: DecisionLedger;
      operator?: string;
    };
    runComparison(parsed.request, parsed.ledger);
    if (parsed.operator) {
      state.operator = parsed.operator;
    }
    return true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  state.request = null;
  state.workbench = null;
  state.selectedStep = 0;
  state.selectedDivergence = null;
  state.error = null;
}
