import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../core/hash";
import type { StoredBatch } from "../core/types";

export class BatchStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(batchId: string): string {
    if (!/^[a-f0-9-]+$/i.test(batchId)) throw new Error("非法 batchId");
    return join(this.dir, `${batchId}.json`);
  }

  has(batchId: string): boolean {
    try {
      readFileSync(this.file(batchId));
      return true;
    } catch {
      return false;
    }
  }

  get(batchId: string): StoredBatch {
    return JSON.parse(readFileSync(this.file(batchId), "utf8")) as StoredBatch;
  }

  list(): { batchId: string; createdAt?: string }[] {
    return readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const stored = JSON.parse(readFileSync(join(this.dir, name), "utf8")) as StoredBatch;
          return [{ batchId: stored.batchId, createdAt: stored.createdAt }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.batchId.localeCompare(b.batchId));
  }

  /**
   * Atomic write: serialize fully before touching the destination; publish via
   * rename. A failed batch therefore never exposes a visible partial file.
   */
  put(stored: StoredBatch): void {
    const target = this.file(stored.batchId);
    const tmp = `${target}.tmp-${process.pid}`;
    const serialized = canonicalJson(stored);
    try {
      writeFileSync(tmp, serialized, { encoding: "utf8", flag: "wx" });
      renameSync(tmp, target);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }
}
