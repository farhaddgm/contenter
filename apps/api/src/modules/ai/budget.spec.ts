import { describe, expect, it, vi } from 'vitest';
import type { BudgetSettings } from '@contenter/shared';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AiAlertsService } from './ai-alerts.service';
import { BudgetService } from './budget.service';

const NOW = new Date('2026-10-14T10:00:00Z'); // 22 Mehr 1405: month 2026-09-22T20:30Z .. 2026-10-22T20:30Z

interface Job {
  type: string;
  topicId: string | null;
  targetType: string;
  targetId: string;
  costUsd: number;
  finishedAt: Date;
}

const job = (over: Partial<Job> = {}): Job => ({
  type: 'GENERATE_CONTENT',
  topicId: 't1',
  targetType: 'Content',
  targetId: 'c1',
  costUsd: 1,
  finishedAt: new Date('2026-10-10T00:00:00Z'),
  ...over,
});

function setup(jobs: Job[], settings?: Partial<BudgetSettings>) {
  const store = new Map<string, unknown>();
  if (settings) store.set('budget', settings);
  const prisma = {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.has(where.key) ? { value: store.get(where.key) } : null,
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        store.set(where.key, create.value);
      },
    },
    aiJob: {
      findMany: async ({ where }: { where: { finishedAt: { gte: Date; lt: Date } } }) =>
        jobs.filter((j) => j.finishedAt >= where.finishedAt.gte && j.finishedAt < where.finishedAt.lt),
    },
    topic: {
      findMany: async () => [
        { id: 't1', businessId: 'b1' },
        { id: 't2', businessId: 'b2' },
      ],
      findUnique: async ({ where }: { where: { id: string } }) =>
        ({ t1: { businessId: 'b1' }, t2: { businessId: 'b2' } })[where.id] ?? null,
    },
    business: {
      findMany: async () => [
        { id: 'b1', name: 'برند الف' },
        { id: 'b2', name: 'برند ب' },
      ],
    },
  };
  const send = vi.fn(async () => true);
  const audit = { log: vi.fn() } as unknown as AuditService;
  const svc = new BudgetService(
    prisma as unknown as PrismaService,
    audit,
    { send } as unknown as AiAlertsService,
  );
  return { svc, send, store };
}

describe('BudgetService.usage', () => {
  it('starts from the default of about one subscription, warn only', async () => {
    const { svc } = setup([]);
    expect(await svc.getSettings()).toMatchObject({ monthlyUsd: 20, hardStop: false, calendar: 'persian' });
  });

  it('adds up this Persian month only, per task and per business', async () => {
    const { svc } = setup([
      job({ costUsd: 4 }),
      job({ type: 'IDEATE', costUsd: 1.5, topicId: 't2' }),
      job({ type: 'BUSINESS_BUILD', topicId: null, targetType: 'Business', targetId: 'b1', costUsd: 2 }),
      job({ costUsd: 50, finishedAt: new Date('2026-09-22T20:29:00Z') }), // last month
      job({ costUsd: 50, finishedAt: new Date('2026-10-22T20:31:00Z') }), // next month
    ]);
    const u = await svc.usage();
    expect(u.label).toBe('1405/7');
    expect(u.spentUsd).toBe(7.5);
    expect(u.capUsd).toBe(20);
    expect(u.percent).toBe(0.375);
    expect(u.level).toBe('ok');
    expect(u.byTask.map((t) => [t.type, t.usd])).toEqual([
      ['GENERATE_CONTENT', 4],
      ['BUSINESS_BUILD', 2],
      ['IDEATE', 1.5],
    ]);
    expect(u.byBusiness.map((b) => [b.businessId, b.usd, b.jobs])).toEqual([
      ['b1', 6, 2],
      ['b2', 1.5, 1],
    ]);
  });

  it('lists a business with a cap even before it spent, and reports its level', async () => {
    const { svc } = setup([job({ costUsd: 9 })], { businesses: { b1: 10, b2: 5 } });
    const u = await svc.usage(undefined, NOW);
    const b1 = u.byBusiness.find((b) => b.businessId === 'b1')!;
    const b2 = u.byBusiness.find((b) => b.businessId === 'b2')!;
    expect(b1).toMatchObject({ capUsd: 10, level: 'warning' });
    expect(b2).toMatchObject({ usd: 0, capUsd: 5, level: 'ok' });
  });

  it('works without a cap', async () => {
    const { svc } = setup([job({ costUsd: 3 })], { monthlyUsd: null });
    const u = await svc.usage();
    expect(u).toMatchObject({ capUsd: null, percent: null, level: 'none', spentUsd: 3 });
  });
});

describe('BudgetService.blockReason', () => {
  const args = { topicId: 't1', targetType: 'Content', targetId: 'c1' };

  it('never blocks without the hard stop, even far over the cap', async () => {
    const { svc } = setup([job({ costUsd: 99 })]);
    expect(await svc.blockReason(args, NOW)).toBeNull();
  });

  it('blocks everything once the whole budget is used up', async () => {
    const { svc } = setup([job({ costUsd: 21 })], { hardStop: true });
    expect(await svc.blockReason(args, NOW)).toMatch(/monthly AI budget is used up/);
  });

  it('lets a job through while there is room', async () => {
    const { svc } = setup([job({ costUsd: 5 })], { hardStop: true });
    expect(await svc.blockReason(args, NOW)).toBeNull();
  });

  it("blocks only the business whose own cap is used up, found from its topic or as the job's target", async () => {
    const { svc } = setup([job({ costUsd: 6 })], { hardStop: true, businesses: { b1: 5 } });
    expect(await svc.blockReason(args, NOW)).toMatch(/برند الف/);
    expect(
      await svc.blockReason({ topicId: null, targetType: 'Business', targetId: 'b1' }, NOW),
    ).toMatch(/برند الف/);
    expect(await svc.blockReason({ topicId: 't2', targetType: 'Content', targetId: 'c2' }, NOW)).toBeNull();
  });
});

describe('BudgetService.check', () => {
  it('warns once at the warning level and once more when the budget is used up', async () => {
    const jobs = [job({ costUsd: 17 })];
    const { svc, send } = setup(jobs);
    await svc.check(NOW);
    await svc.check(NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      expect.stringContaining('global:warning'),
      'AI_BUDGET_WARNING',
      expect.stringContaining('$17.00 / $20.00 (85%)'),
      expect.any(Number),
    ]);
    jobs.push(job({ costUsd: 4 }));
    await svc.check(NOW);
    await svc.check(NOW);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toBe('AI_BUDGET_EXCEEDED');
  });

  it('sends only the "used up" message when the budget jumps straight past the cap', async () => {
    const { svc, send } = setup([job({ costUsd: 30 })]);
    await svc.check(NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('AI_BUDGET_EXCEEDED');
  });

  it('starts over in a new month, and remembers across restarts through the stored state', async () => {
    const jobs = [
      job({ costUsd: 18 }),
      job({ costUsd: 18, finishedAt: new Date('2026-10-25T00:00:00Z') }),
    ];
    const first = setup(jobs);
    await first.svc.check(NOW);
    expect(first.send).toHaveBeenCalledTimes(1);
    // a second service sharing the stored state (a restart) does not repeat the alert
    const second = setup(jobs);
    for (const [k, v] of first.store) second.store.set(k, v);
    await second.svc.check(NOW);
    expect(second.send).not.toHaveBeenCalled();
    // the next Persian month has its own alerts
    await second.svc.check(new Date('2026-10-26T10:00:00Z'));
    expect(second.send).toHaveBeenCalledTimes(1);
  });

  it('warns about a business whose own cap is nearly used up', async () => {
    const { svc, send } = setup([job({ costUsd: 4.5 })], { monthlyUsd: null, businesses: { b1: 5 } });
    await svc.check(NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toContain('برند الف');
  });

  it('does nothing without any cap', async () => {
    const { svc, send } = setup([job({ costUsd: 500 })], { monthlyUsd: null });
    await svc.check(NOW);
    expect(send).not.toHaveBeenCalled();
  });
});
