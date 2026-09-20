import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApiMiddleware } from "../src/server/api";
import { mkdtepSyncFixture } from "./helpers";
import { makeSampleBatch } from "./sample-data/sample";
import type { BatchInput } from "../src/core/types";

let server: Server;
let base: string;

const ok = (status: number) => status >= 200 && status < 300;

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  const middleware = createApiMiddleware(mkdtepSyncFixture());
  server = createServer((req, res) => {
    middleware(req, res, (error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("HTTP API", () => {
  it("健康检查", async () => {
    const { status, body } = await call("/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("提交批次返回报告；相同输入复用同一 batchId", async () => {
    const input = makeSampleBatch();
    const first = await call("/batches", { method: "POST", body: input });
    expect(first.status).toBe(201);
    expect(first.body.report.findings.length).toBeGreaterThan(5);
    const second = await call("/batches", { method: "POST", body: structuredClone(input) });
    expect(second.status).toBe(200);
    expect(second.body.reused).toBe(true);
    expect(second.body.batchId).toBe(first.body.batchId);
  });

  it("校验失败不落库、返回 422", async () => {
    const bad = makeSampleBatch() as unknown as { baseline?: unknown };
    delete bad.baseline;
    const { status } = await call("/batches", { method: "POST", body: bad });
    expect(status).toBe(422);
    const list = await call("/batches");
    expect(list.body.batches).toHaveLength(1);
  });

  it("记录分类、冲突与撤销（追加事件）", async () => {
    const input = makeSampleBatch();
    const created = await call("/batches", { method: "POST", body: input });
    const batchId = created.body.batchId as string;
    const findingId = (created.body.report.findings as { id: string; kind: string }[])
      .find((f) => f.kind === "focus-trap")!.id;

    const classify = (operator: string, classification: string, reason: string) =>
      call(`/batches/${batchId}/decisions`, {
        method: "POST",
        body: { type: "classify", findingId, operator, classification, reason }
      });
    const a = await classify("alice", "defect", "r1");
    expect(a.status).toBe(200);
    const b = await classify("bob", "intentional", "r2");
    const state = b.body.states.find((s: { findingId: string }) => s.findingId === findingId);
    expect(state.conflict).toBe(true);
    expect(state.exemption.validity.status).toBe("active");

    const undo = await call(`/batches/${batchId}/decisions`, {
      method: "POST",
      body: { type: "undo", eventId: a.body.event.id, operator: "alice", reason: "误操作" }
    });
    expect(undo.body.event.revokes).toBe(a.body.event.id);
    const after = await call(`/batches/${batchId}/decisions`);
    const afterState = after.body.states.find((s: { findingId: string }) => s.findingId === findingId);
    expect(afterState.history).toHaveLength(3);
    expect(afterState.conflict).toBe(false);
  });

  it("重新校验豁免：指纹变更后失效", async () => {
    const input: BatchInput = makeSampleBatch();
    const created = await call("/batches", { method: "POST", body: input });
    const batchId = created.body.batchId as string;
    const findingId = (created.body.report.findings as { id: string; kind: string }[])
      .find((f) => f.kind === "focus-trap")!.id;
    await call(`/batches/${batchId}/decisions`, {
      method: "POST",
      body: { type: "classify", findingId, operator: "bob", classification: "intentional", reason: "保留" }
    });
    const result = await call(`/batches/${batchId}/exemptions/revalidate`, { method: "POST" });
    expect(result.body.exemptions[0].validity.status).toBe("active");
  });

  it("导出包包含原始树/序列/映射/决定，且可重算校验", async () => {
    const input = makeSampleBatch();
    const created = await call("/batches", { method: "POST", body: input });
    const batchId = created.body.batchId as string;
    const response = await fetch(`${base}/batches/${batchId}/export`);
    expect(response.status).toBe(200);
    const bundle = await response.json();
    expect(bundle.input.operations.length).toBe(input.operations.length);
    expect(bundle.matchMapping).toHaveLength(input.operations.length + 1);
    expect(bundle.report.findings).toEqual(created.body.report.findings);
    expect(bundle.checksums.input).toMatch(/^[a-f0-9]{64}$/);
  });

  it("无状态 replay 不落库", async () => {
    const before = (await call("/batches")).body.batches.length;
    const replayed = await call("/batches/replay", { method: "POST", body: makeSampleBatch() });
    expect(replayed.status).toBe(200);
    expect((await call("/batches")).body.batches.length).toBe(before);
  });

  it("缺操作者或理由时 400/500（不产生事件）", async () => {
    const input = makeSampleBatch();
    const created = await call("/batches", { method: "POST", body: input });
    const batchId = created.body.batchId as string;
    const findingId = created.body.report.findings[0].id;
    const response = await call(`/batches/${batchId}/decisions`, {
      method: "POST",
      body: { type: "classify", findingId, operator: "", classification: "defect", reason: "" }
    });
    expect(ok(response.status)).toBe(false);
    expect(response.status).toBe(500);
  });
});
