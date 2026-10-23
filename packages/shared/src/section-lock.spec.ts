import { describe, expect, it } from 'vitest';
import {
  aiMustSuggest,
  isWriteBlocked,
  SECTION_LOCK_NOTE_MAX,
  SetSectionLockSchema,
  type SectionActor,
  type SectionLock,
} from './section-lock';

const AI: SectionActor = { kind: 'AI' };
const admin: SectionActor = { kind: 'USER', role: 'ADMIN' };
const editor: SectionActor = { kind: 'USER', role: 'EDITOR' };

describe('isWriteBlocked', () => {
  it.each<[SectionLock, SectionActor, boolean]>([
    ['NONE', AI, false],
    ['NONE', editor, false],
    ['NONE', admin, false],
    ['AI_ONLY', AI, true],
    ['AI_ONLY', editor, false],
    ['AI_ONLY', admin, false],
    ['ADMIN_ONLY', AI, true],
    ['ADMIN_ONLY', editor, true],
    ['ADMIN_ONLY', admin, false],
  ])('%s × %j → blocked %s', (lock, actor, blocked) => {
    expect(isWriteBlocked(lock, actor)).toBe(blocked);
  });

  it('does not take a viewer for an admin', () => {
    expect(isWriteBlocked('ADMIN_ONLY', { kind: 'USER', role: 'VIEWER' })).toBe(true);
  });
});

describe('aiMustSuggest', () => {
  it('is true for any lock and false without one', () => {
    expect(aiMustSuggest('AI_ONLY')).toBe(true);
    expect(aiMustSuggest('ADMIN_ONLY')).toBe(true);
    expect(aiMustSuggest('NONE')).toBe(false);
    expect(aiMustSuggest(undefined)).toBe(false);
  });
});

describe('SetSectionLockSchema', () => {
  it('takes a level with an optional trimmed note', () => {
    expect(SetSectionLockSchema.parse({ lock: 'AI_ONLY' })).toEqual({ lock: 'AI_ONLY', note: '' });
    expect(SetSectionLockSchema.parse({ lock: 'ADMIN_ONLY', note: '  رعایت قانون  ' }).note).toBe('رعایت قانون');
  });
  it('refuses an unknown level and a long note', () => {
    expect(SetSectionLockSchema.safeParse({ lock: 'ALL' }).success).toBe(false);
    expect(SetSectionLockSchema.safeParse({ lock: 'AI_ONLY', note: 'x'.repeat(SECTION_LOCK_NOTE_MAX + 1) }).success).toBe(false);
  });
});
