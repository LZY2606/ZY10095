import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function mkdtepSyncFixture(): string {
  return mkdtempSync(join(tmpdir(), "gsb-test-"));
}
