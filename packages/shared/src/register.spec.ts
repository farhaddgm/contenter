import { describe, expect, it } from 'vitest';
import { registerInstruction, registerMarkers } from './register';

describe('registerMarkers', () => {
  it('finds spoken forms, with or without half-space', () => {
    const r = registerMarkers('ما می‌خوایم یه چیز بگیم. نمیدونم، خوبه؟ اینجوری بهش بگو');
    const found = r.colloquial.map((c) => c.text);
    expect(found).toEqual(
      expect.arrayContaining(['می خوایم', 'یه', 'نمیدونم', 'خوبه', 'اینجوری', 'بهش']),
    );
  });

  it('leaves written verbs alone', () => {
    const r = registerMarkers('می‌خواهیم محصول را معرفی کنیم و می‌گیریم و می‌دانم و می‌گویم.');
    expect(r.colloquial).toEqual([]);
  });

  it('finds stiff phrases, longest first and without double counting', () => {
    const r = registerMarkers('به منظور آنکه بهتر شود، در خصوص آن گزارش می‌باشد.');
    const found = r.stiff.map((s) => s.text);
    expect(found).toContain('به منظور آنکه');
    expect(found).not.toContain('به منظور');
    expect(found).toContain('در خصوص');
  });

  it("takes the admin's extra stiff phrases", () => {
    expect(registerMarkers('اهتمام ورزید', ['اهتمام ورزید']).stiff).toHaveLength(1);
  });
});

describe('registerInstruction', () => {
  it('is empty when no register is set', () => {
    expect(registerInstruction(null)).toBeNull();
    expect(registerInstruction('FORMAL')).toContain('FORMAL');
  });
});
