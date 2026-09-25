import { describe, expect, it } from 'vitest';
import { categorize, fingerprint, normalizeForFingerprint, sanitize } from './error-classifier';
import { extractTitle } from './smart.services';

describe('categorize', () => {
  it('detects database errors by name or message', () => {
    expect(
      categorize({ source: 'SERVER', message: 'x', errorName: 'PrismaClientKnownRequestError' }),
    ).toBe('DATABASE');
    expect(categorize({ source: 'SERVER', message: 'relation "Topic" does not exist' })).toBe(
      'DATABASE',
    );
  });
  it('treats AI job failures as AI', () => {
    expect(categorize({ source: 'AI_JOB', message: 'IDEATE failed: boom' })).toBe('AI');
  });
  it('maps status codes', () => {
    expect(categorize({ source: 'SERVER', message: 'x', statusCode: 403 })).toBe('AUTH');
    expect(categorize({ source: 'SERVER', message: 'x', statusCode: 404 })).toBe('NOT_FOUND');
    expect(categorize({ source: 'SERVER', message: 'x', statusCode: 400 })).toBe('VALIDATION');
  });
  it('detects network and client runtime errors', () => {
    expect(categorize({ source: 'CLIENT', message: 'Failed to fetch' })).toBe('NETWORK');
    expect(
      categorize({
        source: 'CLIENT',
        message: "Cannot read properties of undefined (reading 'x')",
      }),
    ).toBe('CLIENT_RUNTIME');
    expect(categorize({ source: 'SERVER', message: 'weird' })).toBe('UNKNOWN');
  });
});

describe('fingerprint', () => {
  it('groups errors that only differ by ids and numbers', () => {
    const a = fingerprint({
      source: 'SERVER',
      category: 'UNKNOWN',
      message: 'Topic cmug2thzi0005i76kv0g4lc8u failed after 3 tries',
      path: '/api/topics/cmug2thzi0005i76kv0g4lc8u',
    });
    const b = fingerprint({
      source: 'SERVER',
      category: 'UNKNOWN',
      message: 'Topic cmzz9aaaa0005i76kv0g4lc8x failed after 7 tries',
      path: '/api/topics/cmzz9aaaa0005i76kv0g4lc8x',
    });
    const c = fingerprint({
      source: 'SERVER',
      category: 'UNKNOWN',
      message: 'Something else',
      path: '/api/topics',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('normalizes quoted values', () => {
    expect(normalizeForFingerprint(`Unknown field "abc" at 12`)).toBe('Unknown field :s at :n');
  });
});

describe('sanitize', () => {
  it('redacts secrets and truncates', () => {
    const out = sanitize({
      email: 'a@b.c',
      password: 'x',
      nested: { apiKey: 'k', text: 'y'.repeat(600) },
      list: Array(30).fill(1),
    }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[redacted]');
    expect(String((out.nested as Record<string, unknown>).text)).toContain('…(600)');
    expect((out.list as unknown[]).length).toBe(21);
  });
});

describe('extractTitle', () => {
  it('uses the first heading', () => {
    expect(extractTitle('intro\n# **مشکل در تحلیل نمونه**\n## خلاصه')).toBe('مشکل در تحلیل نمونه');
  });
  it('falls back to the first line and strips "عنوان:"', () => {
    expect(extractTitle('\n\nعنوان: ایده‌ها تکراری هستند\nمتن')).toBe('ایده‌ها تکراری هستند');
  });
  it('handles empty content', () => {
    expect(extractTitle('   ')).toBe('بدون عنوان');
  });
});
