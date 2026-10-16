import { describe, expect, it, vi } from 'vitest';
import { MIN_PRODUCTIVITY_SAMPLES, ProductivityQuerySchema } from '@contenter/shared';
import type { AuthUser } from '../../common/auth.decorators';
import type { AccessService } from '../../common/access';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { DashboardService } from './dashboard.module';
import {
  approvalOf,
  buildProductivity,
  durationStats,
  percentile,
  type ApprovedRow,
} from './productivity';

const at = (iso: string) => new Date(`2026-10-${iso}:00Z`);
const SINCE = at('01T00:00');

/** A content created at `created`, sent for review at `submitted`, approved at `approved`. */
const row = (
  created: string,
  submitted: string,
  approved: string,
  editedByHuman = false,
): ApprovedRow => ({
  createdAt: at(created),
  reviews: [
    { decision: 'SUBMITTED', createdAt: at(submitted) },
    { decision: 'APPROVED', createdAt: at(approved) },
  ],
  editedByHuman,
});

describe('percentile', () => {
  it('uses the nearest rank and has nothing for an empty list', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe('durationStats', () => {
  it(`shows no median or slow end below ${MIN_PRODUCTIVITY_SAMPLES} samples`, () => {
    expect(durationStats([1, 2, 3, 4])).toEqual({ samples: 4, medianHours: null, p90Hours: null });
  });
  it('gives the median and the 90th percentile in hours, rounded to one decimal', () => {
    const s = durationStats([10, 1, 2.25, 3, 4, 5, 6, 7, 8, 9]);
    expect(s.samples).toBe(10);
    expect(s.medianHours).toBe(5);
    expect(s.p90Hours).toBe(9);
  });
});

describe('approvalOf', () => {
  it('takes the last approval and the review it ended', () => {
    const r: ApprovedRow = {
      createdAt: at('01T00:00'),
      editedByHuman: false,
      reviews: [
        { decision: 'SUBMITTED', createdAt: at('02T00:00') },
        { decision: 'APPROVED', createdAt: at('03T00:00') },
        // reopened, sent again, approved again
        { decision: 'SUBMITTED', createdAt: at('05T00:00') },
        { decision: 'APPROVED', createdAt: at('06T00:00') },
      ],
    };
    expect(approvalOf(r)).toEqual({ approvedAt: at('06T00:00'), submittedAt: at('05T00:00') });
  });
  it('has no submit when the content was approved directly, and nothing without an approval', () => {
    expect(
      approvalOf({
        createdAt: SINCE,
        editedByHuman: false,
        reviews: [{ decision: 'APPROVED', createdAt: at('02T00:00') }],
      }),
    ).toEqual({ approvedAt: at('02T00:00'), submittedAt: null });
    expect(approvalOf({ createdAt: SINCE, editedByHuman: false, reviews: [] })).toBeNull();
  });
});

describe('buildProductivity', () => {
  const six = [
    row('01T00:00', '01T12:00', '02T00:00', true), // cycle 24h, review 12h
    row('01T00:00', '01T00:00', '01T10:00'), //          10h, 10h
    row('02T00:00', '02T02:00', '02T08:00', true), //     8h, 6h
    row('03T00:00', '03T01:00', '04T01:00'), //          25h, 24h
    row('03T00:00', '03T06:00', '03T12:00'), //          12h, 6h
    row('04T00:00', '04T04:00', '04T20:00', true), //     20h, 16h
  ];
  const jobs = [
    { type: 'GENERATE_CONTENT' as const, total: 8, failed: 1, retried: 2, costUsd: 1.5 },
    { type: 'IDEATE' as const, total: 2, failed: 0, retried: 0, costUsd: 0.5 },
  ];

  it('counts approved contents, how many an editor changed and how many were approved as written', () => {
    const s = buildProductivity({ days: 30, since: SINCE, contents: six, jobs });
    expect(s).toMatchObject({ approved: 6, edited: 3, unedited: 3, uneditedShare: 0.5 });
  });

  it('measures the way to approval and the review separately', () => {
    const s = buildProductivity({ days: 30, since: SINCE, contents: six, jobs });
    // cycle (sorted): 8, 10, 12, 20, 24, 25 → median rank 3 = 12, p90 rank 6 = 25
    expect(s.cycle).toEqual({ samples: 6, medianHours: 12, p90Hours: 25 });
    // review (sorted): 6, 6, 10, 12, 16, 24 → median rank 3 = 10
    expect(s.review.medianHours).toBe(10);
  });

  it('divides the cost of every AI job by the approved contents, and lists the job types by cost', () => {
    const s = buildProductivity({ days: 30, since: SINCE, contents: six, jobs });
    expect(s.cost).toEqual({ totalUsd: 2, jobs: 10, failedJobs: 1, perApprovedUsd: 2 / 6 });
    expect(s.byJobType.map((j) => j.type)).toEqual(['GENERATE_CONTENT', 'IDEATE']);
  });

  it('does not count a content approved before the period', () => {
    const old = row('01T00:00', '01T01:00', '01T02:00');
    const s = buildProductivity({
      days: 7,
      since: at('02T00:00'),
      contents: [old, ...six.slice(0, 2)],
      jobs: [],
    });
    expect(s.approved).toBe(1); // only the one approved on the 2nd
  });

  it('shows no shares, medians or per-content cost below the minimum', () => {
    const s = buildProductivity({ days: 30, since: SINCE, contents: six.slice(0, 3), jobs });
    expect(s.approved).toBe(3);
    expect(s.uneditedShare).toBeNull();
    expect(s.cycle.medianHours).toBeNull();
    expect(s.cost.perApprovedUsd).toBeNull();
    // the plain counts and the total cost are still true
    expect(s.cost.totalUsd).toBe(2);
    expect(s.edited).toBe(2);
  });

  it('handles an empty period', () => {
    const s = buildProductivity({ days: 30, since: SINCE, contents: [], jobs: [] });
    expect(s).toMatchObject({
      approved: 0,
      uneditedShare: null,
      cost: { totalUsd: 0, perApprovedUsd: null },
    });
  });
});

describe('ProductivityQuerySchema', () => {
  it('defaults to 30 days and accepts only the offered periods', () => {
    expect(ProductivityQuerySchema.parse({}).days).toBe(30);
    expect(ProductivityQuerySchema.parse({ days: '90' }).days).toBe(90);
    expect(ProductivityQuerySchema.safeParse({ days: '45' }).success).toBe(false);
    expect(ProductivityQuerySchema.safeParse({ topicId: '' }).success).toBe(false);
  });
});

describe('DashboardService.productivity', () => {
  const admin = { id: 'a', role: 'ADMIN' } as AuthUser;
  const editor = { id: 'e', role: 'EDITOR' } as AuthUser;

  function setup() {
    const prisma = {
      topic: { findMany: vi.fn(async () => [{ id: 't1' }, { id: 't2' }]) },
      content: { findMany: vi.fn(async () => []) },
      aiJob: { groupBy: vi.fn(async () => []) },
    };
    const access = {
      visibleTopics: (u: AuthUser) =>
        u.role === 'ADMIN' ? undefined : { OR: [{ createdById: u.id }] },
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      access as unknown as AccessService,
    );
    return { service, prisma };
  }

  it('lets an admin without filters see everything: no topic restriction at all', async () => {
    const { service, prisma } = setup();
    await service.productivity(admin, { days: 30 });
    expect(prisma.topic.findMany).not.toHaveBeenCalled();
    const where = prisma.content.findMany.mock.calls[0]![0]!.where;
    expect(where).not.toHaveProperty('topicId');
  });

  it('limits an editor to the topics they can reach, and also to the jobs they started', async () => {
    const { service, prisma } = setup();
    await service.productivity(editor, { days: 30 });
    expect(prisma.topic.findMany.mock.calls[0]![0]!.where).toEqual({
      AND: [{ OR: [{ createdById: 'e' }] }, {}, {}],
    });
    expect(prisma.content.findMany.mock.calls[0]![0]!.where).toMatchObject({
      topicId: { in: ['t1', 't2'] },
    });
    const jobWhere = prisma.aiJob.groupBy.mock.calls[0]![0]!.where;
    expect(jobWhere.OR).toEqual([{ topicId: { in: ['t1', 't2'] } }, { createdById: 'e' }]);
  });

  it('narrows to one topic or business through the same visible-topics filter, and then only that topic’s jobs', async () => {
    const { service, prisma } = setup();
    await service.productivity(editor, { days: 7, topicId: 'tX', businessId: 'bX' });
    expect(prisma.topic.findMany.mock.calls[0]![0]!.where).toEqual({
      AND: [{ OR: [{ createdById: 'e' }] }, { id: 'tX' }, { businessId: 'bX' }],
    });
    const jobWhere = prisma.aiJob.groupBy.mock.calls[0]![0]!.where;
    expect(jobWhere.topicId).toEqual({ in: ['t1', 't2'] });
    expect(jobWhere.OR).toBeUndefined();
  });

  it('only looks at the period', async () => {
    const { service, prisma } = setup();
    const before = Date.now();
    await service.productivity(admin, { days: 7 });
    const gte = prisma.aiJob.groupBy.mock.calls[0]![0]!.where.createdAt.gte as Date;
    expect(before - gte.getTime()).toBeGreaterThanOrEqual(7 * 86_400_000 - 1000);
    expect(before - gte.getTime()).toBeLessThan(7 * 86_400_000 + 5000);
  });
});
