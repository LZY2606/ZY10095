/**
 * Determinism primitives.
 *
 * The whole analysis must be reproducible from saved inputs plus the rule
 * version: no wall-clock reads, no randomness, no reliance on object key
 * insertion order. JSON objects are serialized with recursively sorted keys,
 * and every sort uses an explicit comparator.
 */

import { RULE_VERSION } from './types.js';

/** cyrb53 — a small, stable, non-cryptographic 53-bit hash. */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(13, '0');
}

export function hashJson(value: unknown, seed = 0): string {
  return hashString(canonicalJson(value), seed);
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return value;
}

/** JSON with object keys recursively sorted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), stableReplacer);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** Compare strings with an absolute ordering (used everywhere we sort). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function ruleVersion(): string {
  return RULE_VERSION;
}
