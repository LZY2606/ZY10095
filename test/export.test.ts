import { describe, expect, it } from "vitest";
import { buildExportBundle, verifyBundle } from "../src/core/export";
import { runComparison } from "../src/core/engine";
import { makeSampleBatch } from "./sample-data/sample";

describe("导出与离线重放", () => {
  it("导出字节确定，重算报告与校验和一致", () => {
    const input = makeSampleBatch();
    const report = runComparison(input);
    const bundle1 = buildExportBundle(input, report, []);
    const bundle2 = buildExportBundle(structuredClone(input), runComparison(structuredClone(input)), []);
    expect(bundle2).toEqual(bundle1);
    const recomputed = runComparison(bundle1.input);
    expect(verifyBundle(bundle1, recomputed).ok).toBe(true);
  });

  it("篡改保存的输入后校验失败", () => {
    const input = makeSampleBatch();
    const report = runComparison(input);
    const bundle = buildExportBundle(input, report, []);
    bundle.input.candidate.fingerprint = "tampered";
    const result = verifyBundle(bundle, runComparison(bundle.input));
    expect(result.ok).toBe(false);
  });

  it("不接受系统时间影响输出：exportedAt 必须显式提供", () => {
    const input = makeSampleBatch();
    const report = runComparison(input);
    expect(() => buildExportBundle(input, report, [], 123 as unknown as string)).toThrow();
  });
});
