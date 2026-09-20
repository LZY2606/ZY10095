import { semanticAttributes, type FrameModel } from "./derive";
import { canonicalJson } from "./hash";
import type { MatchConfidence, NodeMatch, NodeSignature } from "./types";

export interface MatchSets {
  matches: NodeMatch[];
  added: string[];
  removed: string[];
}

function stableId(domId: string, sig: NodeSignature, model: FrameModel): string {
  const node = model.flat.get(domId)!.node;
  const parts: string[] = [];
  for (const attrName of ["data-gsb-id", "data-testid", "id", "name"]) {
    const value = node.attrs?.[attrName];
    if (value !== undefined && value !== "") parts.push(`${attrName}=${value}`);
  }
  if (parts.length) return parts.join("|");
  return `dom:${domId}`;
}

function ancestorLcs(a: NodeSignature["ancestorContext"], b: NodeSignature["ancestorContext"]): number {
  if (!a.length || !b.length) return 0;
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1]!.role === b[j - 1]!.role && a[i - 1]!.name === b[j - 1]!.name) {
        table[i]![j] = table[i - 1]![j - 1]! + 1;
      } else {
        table[i]![j] = Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
      }
    }
  }
  return table[a.length]![b.length]!;
}

interface Candidate {
  b: string;
  c: string;
  score: number;
  confidence: MatchConfidence;
  evidence: NodeMatch["evidence"];
}

function scorePair(b: string, c: string, baseline: FrameModel, candidate: FrameModel): Candidate | undefined {
  const bs = baseline.signatures.get(b)!;
  const cs = candidate.signatures.get(c)!;
  if (bs.role !== cs.role) return undefined;
  const roleMatch = true;
  const nameEqual = bs.name === cs.name;
  const stableEqual = stableId(b, bs, baseline) === stableId(c, cs, candidate);
  const lcs = ancestorLcs(bs.ancestorContext, cs.ancestorContext);
  const ancestorScore = Math.min(1, lcs / 3);
  const bAttrs = canonicalJson(semanticAttributes(baseline.flat.get(b)!.node));
  const cAttrs = canonicalJson(semanticAttributes(candidate.flat.get(c)!.node));
  const attrsEqual = bAttrs === cAttrs;
  const shadowEqual = bs.inShadow === cs.inShadow;

  let score = 0.25; // role
  if (nameEqual && bs.name) score += 0.25;
  if (stableEqual && !stableId(b, bs, baseline).startsWith("dom:")) score += 0.2;
  score += 0.15 * ancestorScore;
  if (attrsEqual) score += 0.1;
  if (shadowEqual) score += 0.05;
  score = Math.min(1, score);
  if (score < 0.6) return undefined;
  if (!nameEqual && lcs === 0) return undefined;

  const hasStable = stableEqual && !stableId(b, bs, baseline).startsWith("dom:");
  const confidence: MatchConfidence =
    hasStable && roleMatch && nameEqual && score >= 0.7
      ? "exact"
      : score >= 0.75
        ? "high"
        : "medium";
  return {
    b,
    c,
    score: Number(score.toFixed(4)),
    confidence,
    evidence: {
      stableId: stableEqual && !stableId(b, bs, baseline).startsWith("dom:"),
      role: roleMatch,
      name: nameEqual,
      ancestors: lcs,
      attrSignature: attrsEqual
    }
  };
}

function isMatchable(sig: NodeSignature): boolean {
  if (sig.tabReachable) return true;
  if (sig.role === "generic") return false;
  return sig.role !== "none" || sig.name !== "";
}

export function matchFrames(baseline: FrameModel, candidate: FrameModel): MatchSets {
  const baselineIds = baseline.order.filter((id) => isMatchable(baseline.signatures.get(id)!));
  const candidateIds = candidate.order.filter((id) => isMatchable(candidate.signatures.get(id)!));
  const candidates: Candidate[] = [];
  for (const b of baselineIds) {
    for (const c of candidateIds) {
      const candidatePair = scorePair(b, c, baseline, candidate);
      if (candidatePair) candidates.push(candidatePair);
    }
  }
  candidates.sort((x, y) =>
    (y.score - x.score) ||
    (x.b < y.b ? -1 : x.b > y.b ? 1 : 0) ||
    (x.c < y.c ? -1 : x.c > y.c ? 1 : 0)
  );

  const usedB = new Set<string>();
  const usedC = new Set<string>();
  const matches: NodeMatch[] = [];
  for (const cand of candidates) {
    if (usedB.has(cand.b) || usedC.has(cand.c)) continue;
    usedB.add(cand.b);
    usedC.add(cand.c);
    const bs = baseline.signatures.get(cand.b)!;
    matches.push({
      baselineDomId: cand.b,
      candidateDomId: cand.c,
      role: bs.role,
      name: bs.name,
      confidence: cand.confidence,
      score: cand.score,
      evidence: cand.evidence
    });
  }
  const removed = baselineIds.filter((id) => !usedB.has(id));
  const added = candidateIds.filter((id) => !usedC.has(id));
  for (const id of removed) {
    const sig = baseline.signatures.get(id)!;
    matches.push({
      baselineDomId: id,
      role: sig.role,
      name: sig.name,
      confidence: "none",
      score: 0,
      evidence: { stableId: false, role: true, name: sig.name !== "", ancestors: 0, attrSignature: false }
    });
  }
  for (const id of added) {
    const sig = candidate.signatures.get(id)!;
    matches.push({
      candidateDomId: id,
      role: sig.role,
      name: sig.name,
      confidence: "none",
      score: 0,
      evidence: { stableId: false, role: true, name: sig.name !== "", ancestors: 0, attrSignature: false }
    });
  }
  return { matches, added, removed };
}

export function stableIdentifier(domId: string, sig: NodeSignature, model: FrameModel): string {
  return stableId(domId, sig, model);
}
