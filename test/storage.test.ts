import { mkdtepSyncFixture } from "./helpers";
import { describe, expect, it } from "vitest";
import { BatchStore } from "../src/server/storage";
import { runComparison } from "../src/core/engine";
import { makeSampleBatch } from "./sample-data/sample";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StoredBatch } from "../src/core/types";

describe("BatchStore 原子写", () => {
  it("写入后只有正式文件，没有 .tmp 残留", () => {
    const dir = mkdtepSyncFixture();
    const store = new BatchStore(dir);
    const input = makeSampleBatch();
    const report = runComparison(input);
    const stored: StoredBatch = { batchId: report.batchId, input, report, events: [] };
    store.put(stored);
    const files = readdirSync(dir);
    expect(files).toEqual([`${report.batchId}.json`]);
    expect(store.get(report.batchId).batchId).toBe(report.batchId);
  });

  it("序列化失败时不留下任何可见部分结果", () => {
    const dir = mkdtepSyncFixture();
    const store = new BatchStore(dir);
    const circular: unknown = {};
    (circular as { self: unknown }).self = circular;
    expect(() => store.put(circular as StoredBatch)).toThrow();
    const leftovers = readdirSync(dir).filter((name) => !name.startsWith("."));
    expect(leftovers).toEqual([]);
    expect(existsSync(join(dir, "undefined.json.tmp"))).toBe(false);
  });

  it("非法 batchId 被拒绝（路径穿越）", () => {
    const store = new BatchStore(mkdtepSyncFixture());
    expect(() => store.get("../escape")).toThrow();
  });
});
