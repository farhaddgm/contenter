import { describe, expect, it } from 'vitest';
import { formatBusiness, type BusinessForPrompt } from './context';

const business: BusinessForPrompt = {
  name: 'Acme',
  tagline: '',
  industry: '',
  website: '',
  location: '',
  language: 'fa',
  sections: [{ key: 'OVERVIEW', content: 'We sell tea.' }],
};

describe('formatBusiness language register', () => {
  it('is byte-for-byte the same when no register is set', () => {
    const plain = formatBusiness(business);
    expect(formatBusiness({ ...business, register: null })).toBe(plain);
    expect(formatBusiness({ ...business, register: 'nonsense' })).toBe(plain);
    expect(plain).not.toContain('Language register');
  });

  it('adds one line to the head when set', () => {
    const out = formatBusiness({ ...business, register: 'FORMAL' });
    expect(out).toContain('Language register: FORMAL');
    expect(out.indexOf('Language register')).toBeLessThan(out.indexOf('OVERVIEW'));
  });
});
