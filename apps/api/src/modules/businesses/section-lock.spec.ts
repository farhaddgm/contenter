import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import type { AiJob, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { SectionActor, SectionLock } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AiExecutor } from '../ai/ai-executor.service';
import type { ContextLoader } from '../ai/context-loader.service';
import { BusinessReviseRunner } from '../ai/runners/business-extra.runners';
import { BusinessBuildRunner } from '../ai/runners/business.runners';
import type { AuditService } from '../audit/audit.service';
import { ProfileKnowledgeService } from './profile-knowledge.service';
import { SectionLockedError, writeSection } from './section-writer';
import type { AiJobsService } from '../ai/ai-jobs.service';
import type { BusinessNotesService } from './notes-assets.service';

const AI: SectionActor = { kind: 'AI' };
const admin: SectionActor = { kind: 'USER', role: 'ADMIN' };
const editor: SectionActor = { kind: 'USER', role: 'EDITOR' };

const section = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  businessId: 'b1',
  key: 'GUIDELINES',
  content: 'قواعد فعلی',
  source: 'ADMIN',
  lock: 'NONE' as SectionLock,
  updatedById: 'u1',
  reviewedAt: new Date('2026-10-01T00:00:00Z'),
  reviewedById: 'u1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  ...over,
});

/** A transaction client that records what is written. */
function fakeTx(existing: ReturnType<typeof section> | null, opts: { casCount?: number } = {}) {
  const calls = { revisions: [] as unknown[], updateMany: [] as unknown[], upsert: [] as unknown[] };
  const tx = {
    businessSection: {
      findUnique: async () => existing,
      findUniqueOrThrow: async () => ({ ...existing, content: 'new' }),
      update: async ({ data }: { data: unknown }) => ({ ...existing, ...(data as object) }),
      updateMany: async (args: unknown) => {
        calls.updateMany.push(args);
        return { count: opts.casCount ?? 1 };
      },
      upsert: async (args: unknown) => {
        calls.upsert.push(args);
        return {};
      },
    },
    businessSectionRevision: {
      create: async (args: unknown) => {
        calls.revisions.push(args);
        return {};
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls };
}

const write = (tx: Prisma.TransactionClient, actor: SectionActor, content = 'new') =>
  writeSection(tx, {
    businessId: 'b1',
    key: 'GUIDELINES',
    content,
    source: actor.kind === 'AI' ? 'AI' : 'ADMIN',
    userId: actor.kind === 'AI' ? null : 'u1',
    actor,
  });

describe('writeSection and the lock', () => {
  it.each<[SectionLock, string, SectionActor, boolean]>([
    ['NONE', 'AI', AI, true],
    ['NONE', 'editor', editor, true],
    ['AI_ONLY', 'AI', AI, false],
    ['AI_ONLY', 'editor', editor, true],
    ['AI_ONLY', 'admin', admin, true],
    ['ADMIN_ONLY', 'AI', AI, false],
    ['ADMIN_ONLY', 'editor', editor, false],
    ['ADMIN_ONLY', 'admin', admin, true],
  ])('%s × %s → allowed %s', async (lock, _who, actor, allowed) => {
    const { tx, calls } = fakeTx(section({ lock }));
    if (allowed) {
      await expect(write(tx, actor)).resolves.toBeTruthy();
      expect(calls.revisions).toHaveLength(1);
      expect(calls.updateMany).toHaveLength(1);
    } else {
      await expect(write(tx, actor)).rejects.toBeInstanceOf(SectionLockedError);
      // nothing was kept or changed
      expect(calls.revisions).toHaveLength(0);
      expect(calls.updateMany).toHaveLength(0);
    }
  });

  it('answers a person with a 403', async () => {
    const { tx } = fakeTx(section({ lock: 'ADMIN_ONLY' }));
    const err = await write(tx, editor).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as SectionLockedError).lock).toBe('ADMIN_ONLY');
  });

  it('applies the update only if the lock is still the one that was checked', async () => {
    const { tx, calls } = fakeTx(section({ lock: 'NONE' }));
    await write(tx, editor);
    expect(calls.updateMany[0]).toMatchObject({ where: { id: 's1', lock: 'NONE' } });
    // a lock set between the check and the write leaves no row to update
    const raced = fakeTx(section({ lock: 'NONE' }), { casCount: 0 });
    await expect(write(raced.tx, AI)).rejects.toBeInstanceOf(SectionLockedError);
  });

  it('lets a locked section keep its text when the same text is written again', async () => {
    const { tx, calls } = fakeTx(section({ lock: 'ADMIN_ONLY', content: 'same' }));
    await expect(write(tx, editor, 'same')).resolves.toBeTruthy();
    expect(calls.updateMany).toHaveLength(0);
  });

  it('creates a section that does not exist yet, whoever writes it', async () => {
    const { tx, calls } = fakeTx(null);
    await write(tx, AI);
    expect(calls.upsert).toHaveLength(1);
  });
});

// ---------- the AI runners ----------

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const baseBusiness = {
  id: 'b1',
  name: 'Acme',
  tagline: 'x',
  industry: 'y',
  website: '',
  location: 'z',
  language: 'en',
  register: null,
  keyword: null,
  sources: [],
  gaps: [],
  facts: [],
  terms: [],
  assets: [],
  offerings: [],
};

function runnerEnv(sections: ReturnType<typeof section>[]) {
  const suggestions: Record<string, unknown>[] = [];
  const writes: string[] = [];
  const noteUpdates: Record<string, unknown>[] = [];
  const tx = {
    businessSuggestion: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        suggestions.push(data);
        return data;
      },
    },
    businessSection: {
      findUnique: async ({ where }: { where: { businessId_key: { key: string } } }) =>
        sections.find((s) => s.key === where.businessId_key.key) ?? null,
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({}),
      upsert: async ({ create }: { create: { key: string } }) => {
        writes.push(create.key);
        return {};
      },
    },
    businessSectionRevision: { create: async () => ({}) },
    businessFact: { findMany: async () => [] },
    business: { update: async () => ({}) },
    businessNote: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        noteUpdates.push(data);
        return {};
      },
    },
  };
  // writes through updateMany count as writes too
  const origUpdateMany = tx.businessSection.updateMany;
  tx.businessSection.updateMany = async (args: unknown) => {
    const where = (args as { where: { id: string } }).where;
    const key = sections.find((s) => s.id === where.id)?.key;
    if (key) writes.push(key);
    return origUpdateMany();
  };
  const prisma = {
    business: { findUniqueOrThrow: async () => ({ ...baseBusiness, sections }) },
    businessNote: { findUnique: async () => ({ id: 'n1', text: 'note', apply: 'DIRECT' }) },
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
  const ctx = { standingNotes: async () => [] } as unknown as ContextLoader;
  return { prisma: prisma as unknown as PrismaService, ctx, suggestions, writes, noteUpdates };
}

const aiResult = (data: unknown) =>
  ({ execute: vi.fn(async () => ({ data, model: 'm', usage, prompt: { key: 'k', version: 1 } })) }) as unknown as AiExecutor;

describe('BusinessBuildRunner and a locked section', () => {
  const sections = [
    section({ id: 's1', key: 'GUIDELINES', lock: 'AI_ONLY', content: 'قواعد من', source: 'AI' }),
    section({ id: 's2', key: 'OVERVIEW', lock: 'NONE', content: 'old', source: 'AI' }),
    section({ id: 's3', key: 'FAQ', lock: 'ADMIN_ONLY', content: '', source: 'ADMIN' }),
  ];
  const built = {
    tagline: '',
    industry: '',
    website: '',
    location: '',
    gaps: [],
    facts: [],
    sections: [
      { key: 'GUIDELINES', content: 'قواعد تازه' },
      { key: 'OVERVIEW', content: 'معرفی تازه' },
      { key: 'FAQ', content: 'پرسش تازه' },
    ],
  };

  it('turns the model text for a locked section into a suggestion and writes the rest', async () => {
    const env = runnerEnv(sections);
    const runner = new BusinessBuildRunner(env.prisma, aiResult(built), env.ctx);
    const out = await runner.run({ id: 'j1', targetId: 'b1', input: { scope: 'NONE' } } as unknown as AiJob);
    // the locked ones (even an AI-written one the admin confirmed, even an empty one) only get suggestions
    expect(env.suggestions.map((s) => s.key).sort()).toEqual(['FAQ', 'GUIDELINES']);
    expect(env.suggestions.every((s) => /locked/.test(String(s.rationale)))).toBe(true);
    expect(env.writes).toEqual(['OVERVIEW']);
    expect(out.output).toMatchObject({ sectionsWritten: 1, suggestions: 2 });
  });
});

describe('BusinessReviseRunner and a locked section', () => {
  const sections = [
    section({ id: 's1', key: 'GUIDELINES', lock: 'ADMIN_ONLY', content: 'قواعد من', source: 'ADMIN' }),
    section({ id: 's2', key: 'OVERVIEW', lock: 'NONE', content: 'old', source: 'ADMIN' }),
  ];
  const revised = {
    summary: 'done',
    tagline: '',
    industry: '',
    website: '',
    location: '',
    gaps: [],
    sections: [
      { key: 'GUIDELINES', content: 'قواعد بازنویسی‌شده', change: 'rule changed' },
      { key: 'OVERVIEW', content: 'معرفی بازنویسی‌شده', change: 'overview changed' },
    ],
  };

  it('a direct rewrite still goes only to a suggestion for the locked section', async () => {
    const env = runnerEnv(sections);
    const runner = new BusinessReviseRunner(env.prisma, aiResult(revised), env.ctx);
    const out = await runner.run({
      id: 'j1',
      targetId: 'b1',
      input: { noteId: 'n1', apply: 'DIRECT', scope: 'NONE' },
    } as unknown as AiJob);
    expect(env.writes).toEqual(['OVERVIEW']);
    expect(env.suggestions).toHaveLength(1);
    expect(env.suggestions[0]).toMatchObject({ key: 'GUIDELINES' });
    expect(String(env.suggestions[0]!.rationale)).toMatch(/locked.*rule changed/);
    // the note reports only what really changed
    expect(env.noteUpdates[0]).toMatchObject({ changedKeys: ['OVERVIEW'] });
    expect(out.output).toMatchObject({ sectionsChanged: 1, sectionsHeld: 1 });
  });

  it('in suggest mode every section is a suggestion as before', async () => {
    const env = runnerEnv(sections);
    const runner = new BusinessReviseRunner(env.prisma, aiResult(revised), env.ctx);
    const out = await runner.run({
      id: 'j1',
      targetId: 'b1',
      input: { noteId: 'n1', apply: 'SUGGEST', scope: 'NONE' },
    } as unknown as AiJob);
    expect(env.writes).toEqual([]);
    expect(env.suggestions).toHaveLength(2);
    expect(out.output).toMatchObject({ sectionsChanged: 2, sectionsHeld: 0 });
  });
});

// ---------- setting the lock ----------

describe('ProfileKnowledgeService.setSectionLock', () => {
  function service(existing: ReturnType<typeof section> | null) {
    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const prisma = {
      business: { findUnique: async () => ({ id: 'b1' }) },
      businessSection: {
        findUnique: async () => existing,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updated.push(data);
          return data;
        },
      },
    };
    const audit = { log: vi.fn() };
    const svc = new ProfileKnowledgeService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as unknown as AiJobsService,
      {} as unknown as BusinessNotesService,
    );
    return { svc, created, updated, audit };
  }
  const user = { id: 'admin1', role: 'ADMIN' } as AuthUser;

  it('locks a section that was never written, so the lock can come first', async () => {
    const { svc, created } = service(null);
    await svc.setSectionLock('b1', 'GUIDELINES', { lock: 'ADMIN_ONLY', note: ' قانون ' }, user);
    expect(created[0]).toMatchObject({
      businessId: 'b1',
      key: 'GUIDELINES',
      content: '',
      lock: 'ADMIN_ONLY',
      lockedById: 'admin1',
      lockNote: 'قانون',
    });
  });

  it('keeps the date the text last changed, and logs the level but not the note', async () => {
    const existing = section();
    const { svc, updated, audit } = service(existing);
    await svc.setSectionLock('b1', 'GUIDELINES', { lock: 'AI_ONLY', note: 'راز' }, user);
    expect(updated[0]).toMatchObject({ lock: 'AI_ONLY', updatedAt: existing.updatedAt });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'business.section_lock', meta: { key: 'GUIDELINES', lock: 'AI_ONLY' } }),
    );
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('راز');
  });

  it('unlocking clears who, when and why', async () => {
    const { svc, updated, audit } = service(section({ lock: 'ADMIN_ONLY', lockNote: 'x' }));
    await svc.setSectionLock('b1', 'GUIDELINES', { lock: 'NONE', note: 'ignored' }, user);
    expect(updated[0]).toMatchObject({ lock: 'NONE', lockedAt: null, lockedById: null, lockNote: '' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'business.section_unlock' }));
  });
});

// ---------- no way around the one writer ----------

describe('every write of a section text goes through writeSection', () => {
  const root = join(__dirname, '..', '..');
  const ALLOWED = new Set(['section-writer.ts', 'profile-knowledge.service.ts']);
  const WRITE = /\bbusinessSection\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\(/;

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return files(p);
      return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [p] : [];
    });
  }

  it('finds no other code that writes a section row', () => {
    const offenders = files(root)
      .filter((p) => WRITE.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(root.length + 1).replace(/\\/g, '/'))
      .filter((p) => !ALLOWED.has(p.split('/').pop()!));
    expect(offenders).toEqual([]);
  });
});
