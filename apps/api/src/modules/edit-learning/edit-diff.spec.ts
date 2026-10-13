import { describe, expect, it } from 'vitest';
import { clip, diffWords, editStats, hunks, words } from './edit-diff';

const diff = (a: string, b: string) => diffWords(words(a), words(b));

describe('diffWords', () => {
  it('finds nothing when the texts are the same', () => {
    const ops = diff('سلام دنیا', 'سلام دنیا');
    expect(ops).toEqual([{ kind: 'same', words: ['سلام', 'دنیا'] }]);
    expect(editStats(ops).changeRatio).toBe(0);
  });

  it('marks a replaced word as removed and added', () => {
    const ops = diff('این یک متن ساده است', 'این یک متن رسمی است');
    expect(ops.map((o) => [o.kind, o.words.join(' ')])).toEqual([
      ['same', 'این یک متن'],
      ['del', 'ساده'],
      ['add', 'رسمی'],
      ['same', 'است'],
    ]);
  });

  it('finds an inserted sentence and a deleted one', () => {
    expect(diff('الف ب', 'الف جدید ب').map((o) => o.kind)).toEqual(['same', 'add', 'same']);
    expect(diff('الف قدیمی ب', 'الف ب').map((o) => o.kind)).toEqual(['same', 'del', 'same']);
  });

  it('does not count Arabic letters, Persian digits or case as edits', () => {
    // "ي" → "ی", "ك" → "ک", "۱۲" → "12", "Brand" → "brand"
    const ops = diff('علي كتاب ۱۲ Brand', 'علی کتاب 12 brand');
    expect(ops.every((o) => o.kind === 'same')).toBe(true);
  });

  it('keeps punctuation as part of the word: adding a question mark is an edit', () => {
    expect(diff('چرا نه', 'چرا نه؟').map((o) => o.kind)).toEqual(['same', 'del', 'add']);
  });

  it('handles empty texts', () => {
    expect(diff('', '')).toEqual([]);
    expect(diff('', 'الف ب')).toEqual([{ kind: 'add', words: ['الف', 'ب'] }]);
    expect(diff('الف ب', '')).toEqual([{ kind: 'del', words: ['الف', 'ب'] }]);
  });

  it('compares long texts without blowing up', () => {
    const base = Array.from({ length: 2500 }, (_, i) => `w${i}`);
    const edited = [...base.slice(0, 1000), 'تازه', ...base.slice(1010)];
    const ops = diffWords(base, edited);
    const s = editStats(ops);
    expect(s.removedWords).toBe(10);
    expect(s.addedWords).toBe(1);
  });
});

describe('editStats', () => {
  it('gives the share of changed words and the change of length', () => {
    // 10 words, 1 replaced by 1 other: (1 + 1) / (10 + 10) = 10 %
    const before = 'a b c d e f g h i j';
    const after = 'a b c d e f g h i z';
    const s = editStats(diff(before, after));
    expect(s.removedWords).toBe(1);
    expect(s.addedWords).toBe(1);
    expect(s.changeRatio).toBeCloseTo(0.1, 5);
    expect(s.lengthDeltaPct).toBe(0);
  });

  it('shows a shortened text as a negative length change', () => {
    const s = editStats(diff('a b c d e f g h i j', 'a b c d e'));
    expect(s.lengthDeltaPct).toBe(-50);
    expect(s.removedWords).toBe(5);
  });

  it('is 0 for two empty texts', () => {
    expect(editStats([])).toMatchObject({ changeRatio: 0, lengthDeltaPct: 0 });
  });
});

describe('hunks', () => {
  it('shows only the changed passage with a little context', () => {
    const before = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    const after = before.replace('w15', 'تازه');
    const [h, ...rest] = hunks(diff(before, after), 3);
    expect(rest).toEqual([]);
    expect(h).toBe('w12 w13 w14 {-w15-} {+تازه+} w16 w17 w18');
  });

  it('gives one passage per distant change and none when nothing changed', () => {
    const base = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const edited = base.map((w) => (w === 'w5' ? 'x' : w === 'w35' ? 'y' : w));
    expect(hunks(diff(base.join(' '), edited.join(' ')), 2)).toHaveLength(2);
    expect(hunks(diff('a b', 'a b'))).toEqual([]);
  });

  it('merges changes that are close together', () => {
    const out = hunks(diff('a b c d e f', 'a X c d Y f'), 6);
    expect(out).toEqual(['a {-b-} {+X+} c d {-e-} {+Y+} f']);
  });
});

describe('clip', () => {
  it('flattens whitespace and shortens with an ellipsis', () => {
    expect(clip('الف   ب\n\nج', 20)).toBe('الف ب ج');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
  });
});
