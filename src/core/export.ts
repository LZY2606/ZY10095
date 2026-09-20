import { canonicalJson, sha256Hex } from "./hash";
import type { ExportBundle, RunReport, BatchInput, DecisionEvent, NodeMatch } from "./types";
import { RULE_VERSION } from "./types";

export function buildExportBundle(
  input: BatchInput,
  report: RunReport,
  events: DecisionEvent[],
  exportedAt?: string
): ExportBundle {
  if (exportedAt !== undefined && typeof exportedAt !== "string") {
    throw new Error("exportedAt 必须由调用方提供");
  }
  const matchMapping: { frameIndex: number; matches: NodeMatch[] }[] = report.frameReports.map((frame) => ({
    frameIndex: frame.index,
    matches: frame.matches.map((match) => ({ ...match }))
  }));
  const bundle: ExportBundle = {
    schemaVersion: report.schemaVersion,
    ruleVersion: RULE_VERSION,
    input,
    report,
    matchMapping,
    decisions: events.map((event) => ({ ...event })),
    checksums: {
      input: sha256Hex(canonicalJson(stripMeta(input))),
      report: sha256Hex(canonicalJson(report))
    }
  };
  if (exportedAt) bundle.exportedAt = exportedAt;
  return bundle;
}

function stripMeta(input: BatchInput): unknown {
  return {
    schemaVersion: input.schemaVersion,
    operations: input.operations,
    baseline: input.baseline,
    candidate: input.candidate
  };
}

export function verifyBundle(bundle: ExportBundle, recomputed: RunReport): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const inputHash = sha256Hex(canonicalJson(stripMeta(bundle.input)));
  if (inputHash !== bundle.checksums.input) errors.push("输入校验和与导出包不一致");
  const reportHash = sha256Hex(canonicalJson(recomputed));
  if (reportHash !== bundle.checksums.report) errors.push("用保存的输入重算后报告校验和不一致");
  if (bundle.ruleVersion !== recomputed.ruleVersion) errors.push("规则版本不一致");
  return errors.length ? { ok: false, errors } : { ok: true };
}
