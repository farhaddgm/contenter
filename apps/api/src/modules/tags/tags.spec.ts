import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../../common/auth.decorators';
import { CampaignsService } from '../campaigns/campaigns.module';
import { TagsService } from './tags.module';

const user: AuthUser = { id: 'u1', email: 'u@x.test', role: 'EDITOR' };
const audit = { log: vi.fn() } as unknown as AuditService;

describe('TagsService', () => {
  it('rejects tags from another topic and deduplicates ids', async () => {
    const count = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      // only t1 belongs to the topic
      where.id.in.filter((id) => id === 't1').length,
    );
    const svc = new TagsService({ tag: { count } } as unknown as PrismaService, audit);
    await expect(svc.assertInTopic('topic', ['t1', 't1'])).resolves.toEqual(['t1']);
    await expect(svc.assertInTopic('topic', ['t1', 't2'])).rejects.toThrow(BadRequestException);
    await expect(svc.assertInTopic('topic', [])).resolves.toEqual([]);
  });

  it('refuses a second tag whose name differs only by case', async () => {
    const prisma = {
      tag: { findFirst: vi.fn(async () => ({ id: 'other' })), create: vi.fn() },
    } as unknown as PrismaService;
    const svc = new TagsService(prisma, audit);
    await expect(svc.create('topic', { name: 'Sale' }, user)).rejects.toThrow(ConflictException);
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it('sets the tags of a content to exactly the given ones', async () => {
    const update = vi.fn(async () => ({ tags: [{ id: 't1' }] }));
    const prisma = {
      content: { findUnique: async () => ({ topicId: 'topic' }), update },
      tag: { count: async () => 1 },
    } as unknown as PrismaService;
    const svc = new TagsService(prisma, audit);
    await svc.setContentTags('c1', { tagIds: ['t1'] }, user);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tags: { set: [{ id: 't1' }] } } }),
    );
  });

  it('404s for an idea that does not exist', async () => {
    const prisma = { idea: { findUnique: async () => null } } as unknown as PrismaService;
    await expect(
      new TagsService(prisma, audit).setIdeaTags('nope', { tagIds: [] }, user),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CampaignsService', () => {
  const stored = {
    id: 'c1',
    topicId: 'topic',
    name: 'Nowruz',
    startsAt: new Date('2027-03-21T00:00:00Z'),
    endsAt: new Date('2027-04-02T00:00:00Z'),
  };
  const make = () => {
    const update = vi.fn(async () => stored);
    const prisma = {
      campaign: { findUnique: async () => stored, findFirst: async () => null, update },
    } as unknown as PrismaService;
    return { svc: new CampaignsService(prisma, audit), update };
  };

  it('checks a partial date change against the stored dates', async () => {
    const { svc, update } = make();
    await expect(
      svc.update('c1', { startsAt: '2027-05-01T00:00:00.000Z' }, user),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('clears a date with null and leaves untouched fields alone', async () => {
    const { svc, update } = make();
    await svc.update('c1', { endsAt: null }, user);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        name: undefined,
        description: undefined,
        status: undefined,
        startsAt: undefined,
        endsAt: null,
      },
    });
  });
});
