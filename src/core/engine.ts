import { buildFrameViews, toBuildFrameView, type FrameModel } from "./derive";
import { buildSpecificFindings, crossBuildFindings } from "./findings";
import { canonicalJson, fingerprint, sha256Hex } from "./hash";
import { matchFrames } from "./match";
import type {
  BatchInput, BuildReport, FrameReport, RunReport
} from "./types";
import { RULE_VERSION, SCHEMA_VERSION } from "./types";

export function runComparison(input: BatchInput): RunReport {
  const bModels = buildFrameViews(input.baseline, input.operations);
  const cModels = buildFrameViews(input.candidate, input.operations);

  const frameReports: FrameReport[] = bModels.map((bModel, index) => {
    const sets = matchFrames(bModel, cModels[index]!);
    return {
      index,
      baseline: toBuildFrameView(bModel),
      candidate: toBuildFrameView(cModels[index]!),
      matches: sets.matches
    };
  });

  const baselineFindings = buildSpecificFindings("baseline", input.operations, bModels);
  const candidateFindings = buildSpecificFindings("candidate", input.operations, cModels);
  const crossFindings = crossBuildFindings({
    operations: input.operations,
    bFrames: bModels,
    cFrames: cModels,
    frameReports
  });

  const allFindings = [...crossFindings, ...baselineFindings, ...candidateFindings].sort(
    (a, b) =>
      (a.frameIndex - b.frameIndex) ||
      a.kind.localeCompare(b.kind) ||
      a.scope.localeCompare(b.scope) ||
      a.id.localeCompare(b.id)
  );

  const report: Omit<RunReport, "batchId" | "inputFingerprint"> = {
    ruleVersion: RULE_VERSION,
    schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
    operations: input.operations.map((op) => ({ ...op })),
    baseline: toBuildReport(input.baseline, bModels, baselineFindings),
    candidate: toBuildReport(input.candidate, cModels, candidateFindings),
    frameReports,
    findings: allFindings
  };

  const inputFingerprint = sha256Hex(canonicalJson(normalizeInput(input))).slice(0, 32);
  const batchId = fingerprint({ inputFingerprint, ruleVersion: RULE_VERSION });
  return { ...report, batchId, inputFingerprint };
}

function normalizeInput(input: BatchInput): unknown {
  return {
    schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
    operations: input.operations,
    baseline: input.baseline,
    candidate: input.candidate
  };
}

function toBuildReport(
  build: BatchInput["baseline"],
  models: FrameModel[],
  findings: RunReport["findings"]
): BuildReport {
  return {
    id: build.id,
    label: build.label,
    fingerprint: build.fingerprint,
    frames: models.map(toBuildFrameView),
    findings: findings.map((finding) => ({ ...finding }))
  };
}
