import { describe, expect, it } from 'vitest';
import { textDir } from './bidi';

describe('textDir', () => {
  it('is RTL for a Persian sentence that starts with an English word', () => {
    expect(textDir('Instagram یکی از شبکه‌های اجتماعی است')).toBe('rtl');
  });
  it('is LTR for Latin-only text', () => {
    expect(textDir('Hello world')).toBe('ltr');
  });
  it('uses the fallback when there are no letters', () => {
    expect(textDir('123 — 45', 'rtl')).toBe('rtl');
    expect(textDir('', 'ltr')).toBe('ltr');
  });
});
