import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { WalkerProgressService } from './smart-core.services';

type Where = { analysisStatus?: string };

/** A topic with `samples` sample contents of which `analyzed` are analyzed; nothing else exists. */
function service(opts: { samples: number; analyzed: number; skipped: boolean }) {
  const topic = {
    id: 't1',
    title: 'Topic',
    description: 'A description that is definitely longer than thirty characters.',
    activeProfileId: null,
    samplesSkippedAt: opts.skipped ? new Date() : null,
  };
  const zero = async () => 0;
  const none = async () => null;
  const prisma = {
    topic: { findUnique: async () => topic },
    principle: { count: async () => 1 },
    sampleContent: {
      count: async ({ where }: { where: Where }) =>
        where.analysisStatus ? opts.analyzed : opts.samples,
    },
    contentProfile: { count: zero, findFirst: none },
    idea: { count: zero },
    content: { count: zero, findFirst: none },
  } as unknown as PrismaService;
  return new WalkerProgressService(prisma);
}

const step = (p: Awaited<ReturnType<WalkerProgressService['progress']>>, key: string) =>
  p.steps.find((s) => s.key === key)!;

describe('WalkerProgressService — optional sample contents', () => {
  it('keeps both sample steps open without samples and without a skip', async () => {
    const p = await service({ samples: 0, analyzed: 0, skipped: false }).progress('t1');
    expect(step(p, 'add_samples')).toMatchObject({ done: false, skippable: true, skipped: false });
    expect(step(p, 'analyze_samples')).toMatchObject({ done: false, blocked: true });
    expect(p.nextStep).toBe('add_samples');
    expect(p.topic?.samplesSkipped).toBe(false);
  });

  it('settles both sample steps when the admin skips them', async () => {
    const p = await service({ samples: 0, analyzed: 0, skipped: true }).progress('t1');
    expect(step(p, 'add_samples')).toMatchObject({ done: true, skipped: true });
    // not blocked either: the prerequisite (add_samples) is done
    expect(step(p, 'analyze_samples')).toMatchObject({ done: true, skipped: true, blocked: false });
    expect(p.nextStep).toBe('build_profile');
    expect(p.topic?.samplesSkipped).toBe(true);
  });

  it('does not mark steps as skipped when the work exists', async () => {
    const p = await service({ samples: 3, analyzed: 3, skipped: true }).progress('t1');
    expect(step(p, 'add_samples')).toMatchObject({ done: true, skipped: false });
    expect(step(p, 'analyze_samples')).toMatchObject({ done: true, skipped: false });
  });

  it('still works the old way when not skipped', async () => {
    const partial = await service({ samples: 3, analyzed: 1, skipped: false }).progress('t1');
    expect(step(partial, 'add_samples').done).toBe(true);
    expect(step(partial, 'analyze_samples')).toMatchObject({ done: false, current: 1, target: 3 });
    const all = await service({ samples: 3, analyzed: 3, skipped: false }).progress('t1');
    expect(step(all, 'analyze_samples').done).toBe(true);
  });

  it('marks only the sample steps as skippable, also without a project', async () => {
    const p = await service({ samples: 0, analyzed: 0, skipped: false }).progress(null);
    expect(p.steps.filter((s) => s.skippable).map((s) => s.key)).toEqual([
      'add_samples',
      'analyze_samples',
    ]);
  });
});
