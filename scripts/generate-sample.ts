import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../src/core/hash";
import { makeSampleBatch } from "../test/sample-data/sample";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "sample-batch.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, canonicalJson(makeSampleBatch()), "utf8");
console.log(`wrote ${target}`);
