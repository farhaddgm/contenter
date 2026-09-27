import { describe, expect, it } from 'vitest';
import { CreateGoogleAccessSchema, GmailSchema, isGmail, normalizeGmail } from './schemas';

describe('Gmail helpers', () => {
  it('normalizes dots, +tags, case and googlemail.com', () => {
    expect(normalizeGmail('Farhad.DGM+x@GoogleMail.com')).toBe('farhaddgm@gmail.com');
    expect(normalizeGmail('farhad.dgm@gmail.com')).toBe(normalizeGmail('farhaddgm@gmail.com'));
  });
  it('leaves non-Gmail addresses alone apart from case', () => {
    expect(normalizeGmail('A.B@Example.com')).toBe('a.b@example.com');
  });
  it('accepts only Gmail addresses', () => {
    expect(isGmail('a@gmail.com')).toBe(true);
    expect(isGmail('a@gmail.com.evil.io')).toBe(false);
    expect(GmailSchema.safeParse('a@yahoo.com').success).toBe(false);
    expect(GmailSchema.parse(' A@Gmail.com ')).toBe('a@gmail.com');
  });
  it('rejects a password on a Google-only grant', () => {
    const base = { email: 'a@gmail.com', name: 'Ali', role: 'EDITOR' as const };
    expect(CreateGoogleAccessSchema.safeParse({ ...base, loginMethod: 'GOOGLE' }).success).toBe(
      true,
    );
    expect(
      CreateGoogleAccessSchema.safeParse({ ...base, loginMethod: 'GOOGLE', password: '12345678' })
        .success,
    ).toBe(false);
  });
});
