import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecisionEvent, decisionStates, evaluateExemption } from "../core/decisions";
import { runComparison } from "../core/engine";
import { buildExportBundle } from "../core/export";
import { canonicalJson } from "../core/hash";
import { validateBatch } from "../core/validate";
import type { BatchInput, StoredBatch } from "../core/types";
import { BatchStore } from "./storage";

type Middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => Promise<void> | void;

export function createStore(dataDir?: string): BatchStore {
  return new BatchStore(dataDir ?? process.env.GSB_DATA_DIR ?? join(tmpdir(), "gsb-workbench-data"));
}

const defaultStore = createStore();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(canonicalJson(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function withStored(
  store: BatchStore,
  batchId: string,
  res: ServerResponse,
  fn: (stored: StoredBatch) => unknown
): void {
  let stored: StoredBatch;
  try {
    stored = store.get(batchId);
  } catch {
    sendJson(res, 404, { error: `批次 ${batchId} 不存在` });
    return;
  }
  const result = fn(stored);
  if (result !== undefined) sendJson(res, 200, result);
}

export function createApiMiddleware(dataDir?: string): Middleware {
  const store = dataDir ? createStore(dataDir) : defaultStore;
  return async (req, res, next) => {
    try {
      await route(req, res, store);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(res, 400, { error: "请求体不是合法 JSON", detail: error.message });
        return;
      }
      next(error);
    }
  };
}

async function route(req: IncomingMessage, res: ServerResponse, store: BatchStore): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (parts[1] === "health" && method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (parts[1] === "batches" && parts.length === 2) {
    if (method === "GET") {
      sendJson(res, 200, { batches: store.list() });
      return;
    }
    if (method === "POST") {
      const validation = validateBatch(await readBody(req));
      if (!validation.ok) {
        sendJson(res, 422, { error: "输入校验失败", errors: validation.errors });
        return;
      }
      const input: BatchInput = validation.value;
      const report = runComparison(input);
      if (store.has(report.batchId)) {
        sendJson(res, 200, { batchId: report.batchId, reused: true, report });
        return;
      }
      const stored: StoredBatch = {
        batchId: report.batchId,
        input,
        report,
        events: [],
        ...(input.createdAt ? { createdAt: input.createdAt } : {})
      };
      store.put(stored);
      sendJson(res, 201, { batchId: report.batchId, reused: false, report });
      return;
    }
  }

  const batchId = parts[2];
  if (parts[1] !== "batches" || !batchId) {
    sendJson(res, 404, { error: "未知接口" });
    return;
  }

  if (batchId === "replay" && method === "POST" && parts.length === 3) {
    const validation = validateBatch(await readBody(req));
    if (!validation.ok) {
      sendJson(res, 422, { error: "输入校验失败", errors: validation.errors });
      return;
    }
    const report = runComparison(validation.value);
    sendJson(res, 200, { batchId: report.batchId, report });
    return;
  }

  if (batchId === "replay") {
    sendJson(res, 404, { error: "未知接口" });
    return;
  }

  if (method === "GET" && parts.length === 3) {
    withStored(store, batchId, res, (stored) => stored);
    return;
  }

  if (method === "GET" && parts[3] === "decisions" && parts.length === 4) {
    withStored(store, batchId, res, (stored) => ({ states: decisionStates(stored) }));
    return;
  }

  if (method === "POST" && parts[3] === "decisions" && parts.length === 4) {
    const body = (await readBody(req)) as Record<string, unknown>;
    withStored(store, batchId, res, (stored) => {
      const event = appendDecisionEvent(stored, {
        type: body.type as "classify" | "undo",
        operator: body.operator as string,
        reason: body.reason as string,
        at: body.at as string | undefined,
        findingId: body.findingId as string | undefined,
        classification: body.classification as never,
        eventId: body.eventId as string | undefined
      });
      stored.events = [...stored.events, event];
      store.put(stored);
      return { event, states: decisionStates(stored) };
    });
    return;
  }

  if (method === "POST" && parts[3] === "exemptions" && parts[4] === "revalidate" && parts.length === 5) {
    withStored(store, batchId, res, (stored) => ({
      exemptions: stored.events
        .filter((event) => event.type === "classify" && event.classification === "intentional" && event.scope)
        .sort((a, b) => b.seq - a.seq)
        .map((event) => ({
          eventId: event.id,
          scope: event.scope!,
          validity: evaluateExemption(stored.report, event.scope!)
        }))
    }));
    return;
  }

  if (method === "GET" && parts[3] === "export" && parts.length === 4) {
    withStored(store, batchId, res, (stored) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="gsb-${stored.batchId}.json"`);
      res.end(canonicalJson(buildExportBundle(stored.input, stored.report, stored.events)));
      return undefined;
    });
    return;
  }

  sendJson(res, 404, { error: "未知接口" });
}
