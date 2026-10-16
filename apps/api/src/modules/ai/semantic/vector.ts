/** Cosine similarity of two vectors of the same length, -1..1; 0 for an empty or zero vector. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface ScoredChunk {
  referenceId: string;
  idx: number;
  text: string;
  score: number;
}

/**
 * The best chunks within a character budget: highest similarity first, each chunk counted at its
 * length. At most `perReference` chunks come from one reference so a single long document cannot
 * crowd out the rest. The result is put back in reading order (reference, then position).
 */
export function pickWithinBudget(
  chunks: ScoredChunk[],
  budget: number,
  perReference = 8,
  referenceOrder: string[] = [],
): ScoredChunk[] {
  const taken: ScoredChunk[] = [];
  const perRef = new Map<string, number>();
  let left = budget;
  for (const c of [...chunks].sort((a, b) => b.score - a.score || a.idx - b.idx)) {
    if (c.text.length > left) continue;
    if ((perRef.get(c.referenceId) ?? 0) >= perReference) continue;
    taken.push(c);
    perRef.set(c.referenceId, (perRef.get(c.referenceId) ?? 0) + 1);
    left -= c.text.length;
  }
  const order = (id: string) => {
    const i = referenceOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return taken.sort((a, b) => order(a.referenceId) - order(b.referenceId) || a.idx - b.idx);
}
