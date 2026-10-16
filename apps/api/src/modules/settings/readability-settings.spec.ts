import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { SettingsService } from './settings.module';

function setup(stored: unknown) {
  const upsert = vi.fn(async () => ({}));
  const log = vi.fn();
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async () => (stored === undefined ? null : { value: stored })),
      upsert,
    },
  };
  const svc = new SettingsService(
    prisma as unknown as PrismaService,
    { log } as unknown as AuditService,
    {} as Env,
  );
  return { svc, upsert, log };
}

describe('SettingsService readability', () => {
  it('has defaults when nothing is stored', async () => {
    expect(await setup(undefined).svc.getReadability()).toEqual({
      extraPhrases: [],
      maxAvgSentenceWords: null,
    });
  });

  it('reads what is stored, and falls back to the defaults for a damaged value', async () => {
    expect(
      await setup({ extraPhrases: ['راهکار نوین'], maxAvgSentenceWords: 12 }).svc.getReadability(),
    ).toEqual({ extraPhrases: ['راهکار نوین'], maxAvgSentenceWords: 12 });
    expect(await setup({ extraPhrases: 'x' }).svc.getReadability()).toEqual({
      extraPhrases: [],
      maxAvgSentenceWords: null,
    });
  });

  it('saves and audits a change', async () => {
    const { svc, upsert, log } = setup({ extraPhrases: ['الف الف'], maxAvgSentenceWords: null });
    await svc.updateReadability({ extraPhrases: ['الف الف'], maxAvgSentenceWords: null }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settings.update', entityId: 'readability' }),
    );
  });
});

describe('SettingsService similarity', () => {
  it('has defaults, ignores a damaged value (also copyAt below warnAt) and audits a change', async () => {
    expect(await setup(undefined).svc.getSimilarity()).toEqual({ warnAt: 0.55, copyAt: 0.8 });
    expect(await setup({ warnAt: 0.9, copyAt: 0.5 }).svc.getSimilarity()).toEqual({
      warnAt: 0.55,
      copyAt: 0.8,
    });
    expect(await setup({ warnAt: 0.4, copyAt: 0.7 }).svc.getSimilarity()).toEqual({
      warnAt: 0.4,
      copyAt: 0.7,
    });
    const { svc, upsert, log } = setup({ warnAt: 0.4, copyAt: 0.7 });
    await svc.updateSimilarity({ warnAt: 0.4, copyAt: 0.7 }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settings.update', entityId: 'similarity' }),
    );
  });
});

describe('SettingsService golden', () => {
  it('has defaults, ignores a damaged value and audits a change', async () => {
    expect(await setup(undefined).svc.getGolden()).toEqual({ maxExamples: 2, maxChars: 1500 });
    expect(await setup({ maxExamples: 9 }).svc.getGolden()).toEqual({
      maxExamples: 2,
      maxChars: 1500,
    });
    expect(await setup({ maxExamples: 0, maxChars: 800 }).svc.getGolden()).toEqual({
      maxExamples: 0,
      maxChars: 800,
    });
    const { svc, upsert, log } = setup({ maxExamples: 1, maxChars: 900 });
    await svc.updateGolden({ maxExamples: 1, maxChars: 900 }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'golden' }));
  });
});

describe('SettingsService variants', () => {
  it('has defaults, ignores a damaged value and audits a change', async () => {
    expect(await setup(undefined).svc.getVariants()).toEqual({ maxVariants: 3 });
    expect(await setup({ maxVariants: 7 }).svc.getVariants()).toEqual({ maxVariants: 3 });
    expect(await setup({ maxVariants: 2 }).svc.getVariants()).toEqual({ maxVariants: 2 });
    const { svc, upsert, log } = setup({ maxVariants: 1 });
    await svc.updateVariants({ maxVariants: 1 }, 'u1');
    expect(upsert).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'variants' }));
  });
});
