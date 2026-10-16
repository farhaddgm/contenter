/**
 * Word-level difference between an AI draft and the text an editor approved
 * (docs/30-learn-from-edits.md). Pure code: the model never sees raw texts to compare, only the
 * hunks computed here, and the numbers shown to people come from here too.
 */
import { fold } from '@contenter/shared';

export type DiffKind = 'same' | 'del' | 'add';

export interface DiffOp {
  kind: DiffKind;
  /** The words of this run, in order. For `same` they are the words of the *new* text. */
  words: string[];
}

export interface EditStats {
  beforeWords: number;
  afterWords: number;
  removedWords: number;
  addedWords: number;
  /** `(removed + added) / (before + after)`: 0 = identical, 1 = nothing in common. */
  changeRatio: number;
  /** `(after − before) / before` in percent, rounded; 0 when the draft was empty. */
  lengthDeltaPct: number;
}

/** Longest text compared whole; beyond this only the first words are (the edit is then partial). */
export const MAX_DIFF_WORDS = 3000;

export const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * Words are compared folded (Arabic/Persian letters and digits unified, case ignored), so changing
 * "ي" to "ی" or "۱" to "1" is not an edit worth learning from. Punctuation stays: it is part of style.
 */
const key = (word: string) => fold(word);

/** Shortest edit script between two word lists (longest common subsequence). */
export function diffWords(before: string[], after: string[]): DiffOp[] {
  const a = before.slice(0, MAX_DIFF_WORDS);
  const b = after.slice(0, MAX_DIFF_WORDS);
  const ka = a.map(key);
  const kb = b.map(key);

  // trim what both texts share at the start and the end: edits are usually local
  let start = 0;
  while (start < ka.length && start < kb.length && ka[start] === kb[start]) start++;
  let endA = ka.length;
  let endB = kb.length;
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  // lcs[i][j] = length of the LCS of the last n−i words of A and the last m−j words of B
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        ka[start + i] === kb[start + j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  const push = (kind: DiffKind, word: string) => {
    const last = ops[ops.length - 1];
    if (last?.kind === kind) last.words.push(word);
    else ops.push({ kind, words: [word] });
  };

  for (let i = 0; i < start; i++) push('same', b[i]!);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ka[start + i] === kb[start + j]) {
      push('same', b[start + j]!);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      push('del', a[start + i]!);
      i++;
    } else {
      push('add', b[start + j]!);
      j++;
    }
  }
  while (i < n) push('del', a[start + i++]!);
  while (j < m) push('add', b[start + j++]!);
  for (let k = endB; k < b.length; k++) push('same', b[k]!);
  return ops;
}

export function editStats(ops: DiffOp[]): EditStats {
  let same = 0;
  let removed = 0;
  let added = 0;
  for (const op of ops) {
    if (op.kind === 'same') same += op.words.length;
    else if (op.kind === 'del') removed += op.words.length;
    else added += op.words.length;
  }
  const beforeWords = same + removed;
  const afterWords = same + added;
  const total = beforeWords + afterWords;
  return {
    beforeWords,
    afterWords,
    removedWords: removed,
    addedWords: added,
    changeRatio: total ? (removed + added) / total : 0,
    lengthDeltaPct: beforeWords ? Math.round(((afterWords - beforeWords) / beforeWords) * 100) : 0,
  };
}

/**
 * The changed passages as text a model (and a person) can read: removed words in `{-…-}`, added
 * words in `{+…+}`, with `context` unchanged words around them and `…` where text is skipped.
 */
export function hunks(ops: DiffOp[], context = 6): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.some((s) => s.startsWith('{'))) out.push(current.join(' '));
    current = [];
  };
  ops.forEach((op, index) => {
    if (op.kind === 'del') {
      current.push(`{-${op.words.join(' ')}-}`);
    } else if (op.kind === 'add') {
      current.push(`{+${op.words.join(' ')}+}`);
    } else {
      const first = index === 0;
      const last = index === ops.length - 1;
      if (op.words.length > 2 * context && !first && !last) {
        current.push(...op.words.slice(0, context));
        flush();
        current.push(...op.words.slice(-context));
      } else if (first) {
        current.push(...op.words.slice(-context));
      } else if (last) {
        current.push(...op.words.slice(0, context));
      } else {
        current.push(...op.words);
      }
    }
  });
  flush();
  return out;
}

/** Cuts a text to `max` characters, ending with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
