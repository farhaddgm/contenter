import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MIN_RATIO_SAMPLES } from '@contenter/shared';
import type { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { BusinessForPrompt } from '../ai/context';
import type { ContextLoader } from '../ai/context-loader.service';
import type { BusinessApi } from '../businesses/business-api';
import type { SettingsService } from '../settings/settings.module';
import { ContextPreviewService } from './context-preview.module';

const profile: BusinessForPrompt = {
  name: 'Acme',
  tagline: '',
  industry: '',
  website: '',
  location: '',
  language: 'fa',
  sections: [{ key: 'OVERVIEW', content: 'We sell tea.' }],
};

const admin = { id: 'u1', role: 'ADMIN' } as AuthUser;
const editor = { id: 'u2', role: 'EDITOR' } as AuthUser;

function setup(
  opts: { topic?: unknown; jobs?: { promptChars: number; inputTokens: number; cacheReadTokens: number }[] } = {},
) {
  const topicFind = vi.fn(async (_args: unknown) => opts.topic ?? null);
  const jobFind = vi.fn(async (_args: unknown) => opts.jobs ?? []);
  const prisma = { topic: { findFirst: topicFind }, aiJob: { findMany: jobFind } };
  const access = { visibleTopics: (u: AuthUser) => (u.role === 'ADMIN' ? undefined : { createdById: u.id }) };
  const businesses = { promptProfile: vi.fn(async () => profile) };
  const loaded: BusinessForPrompt = {
    ...profile,
    documents: [{ title: 'Doc', url: '', content: 'Document text.' }],
  };
  const loader = { business: vi.fn(async (..._args: unknown[]) => loaded) };
  const settings = { modelFor: vi.fn(async () => ({ model: 'anthropic:claude-opus-5-5', effort: 'low' })) };
  const svc = new ContextPreviewService(
    prisma as unknown as PrismaService,
    access as unknown as AccessService,
    businesses as unknown as BusinessApi,
    loader as unknown as ContextLoader,
    settings as unknown as SettingsService,
  );
  return { svc, topicFind, jobFind, loader, businesses };
}

describe('ContextPreviewService', () => {
  it('shows the profile alone without a project, and says documents need one', async () => {
    const { svc, loader } = setup();
    const r = await svc.preview('b1', { target: 'DRAFT' }, admin);
    expect(r.blocks.map((b) => b.id)).toEqual(['HEAD', 'SECTION:OVERVIEW']);
    expect(r.needsTopic).toBe(true);
    expect(r.topicId).toBeNull();
    expect(loader.business).not.toHaveBeenCalled();
  });

  it('reads a draft through the project without indexing or calling the embeddings vendor', async () => {
    const { svc, loader } = setup({ topic: { id: 't1', platform: 'INSTAGRAM' } });
    const r = await svc.preview('b1', { target: 'DRAFT', topicId: 't1' }, admin);
    expect(r.blocks.map((b) => b.id)).toContain('DOCUMENTS');
    expect(r.needsTopic).toBe(false);
    expect(loader.business).toHaveBeenCalledWith(
      't1',
      { platform: 'INSTAGRAM', format: 'POST' },
      { semantic: false },
    );
  });

  it('gives ideas the project documents but no draft-only blocks', async () => {
    const { svc, loader } = setup({ topic: { id: 't1', platform: 'INSTAGRAM' } });
    await svc.preview('b1', { target: 'IDEATE', topicId: 't1' }, admin);
    expect(loader.business).toHaveBeenCalledWith('t1', undefined, { semantic: false });
  });

  it('lists empty sections for profile jobs and never needs a project', async () => {
    const { svc, loader } = setup();
    const r = await svc.preview('b1', { target: 'PROFILE' }, admin);
    expect(r.blocks.some((b) => b.id === 'SECTION:PERSONAS')).toBe(true);
    expect(r.needsTopic).toBe(false);
    expect(loader.business).not.toHaveBeenCalled();
  });

  it('answers 404 for a project the caller cannot see, scoped by the access filter', async () => {
    const { svc, topicFind } = setup({ topic: null });
    await expect(svc.preview('b1', { target: 'DRAFT', topicId: 'other' }, editor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(topicFind).toHaveBeenCalledWith({
      where: { id: 'other', businessId: 'b1', AND: [{ createdById: 'u2' }] },
      select: { id: true, platform: true },
    });
  });

  it('shows the input cost to admins only', async () => {
    const a = await setup().svc.preview('b1', { target: 'PROFILE' }, admin);
    const e = await setup().svc.preview('b1', { target: 'PROFILE' }, editor);
    expect(a.estCostUsd).toBeGreaterThan(0);
    expect(e.estCostUsd).toBeNull();
    expect(e.estTokens).toBeGreaterThan(0);
  });

  it('uses the default ratio until enough jobs were measured, then the measured one', async () => {
    const few = await setup({ jobs: [{ promptChars: 3000, inputTokens: 1000, cacheReadTokens: 0 }] }).svc.preview(
      'b1',
      { target: 'PROFILE' },
      admin,
    );
    expect(few.ratio.source).toBe('DEFAULT');

    const jobs = Array.from({ length: MIN_RATIO_SAMPLES }, () => ({
      promptChars: 3000,
      inputTokens: 500,
      cacheReadTokens: 500,
    }));
    const { svc, jobFind } = setup({ jobs });
    const r = await svc.preview('b1', { target: 'PROFILE' }, admin);
    expect(r.ratio).toEqual({ charsPerToken: 3, source: 'MEASURED', samples: MIN_RATIO_SAMPLES });
    expect(jobFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ model: { startsWith: 'claude-opus-5-5' } }) }),
    );
  });
});
