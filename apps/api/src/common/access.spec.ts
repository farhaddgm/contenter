import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { AccessLevel, Role } from '@contenter/shared';
import type { PrismaService } from '../infra/prisma/prisma.service';
import { accessOf, AccessGuard, AccessService, type AccessScopeMeta } from './access';

const me = (role: Role) => ({ id: 'me', email: 'me@x.test', role });

describe('accessOf', () => {
  it('gives admins EDIT everywhere', () => {
    expect(accessOf(me('ADMIN'), { createdById: 'other' }, null)).toBe('EDIT');
  });
  it('gives the creator EDIT by default', () => {
    expect(accessOf(me('EDITOR'), { createdById: 'me' }, null)).toBe('EDIT');
  });
  it('lets a grant override the creator default', () => {
    expect(accessOf(me('EDITOR'), { createdById: 'me' }, 'VIEW')).toBe('VIEW');
  });
  it('uses the grant on projects of others', () => {
    expect(accessOf(me('VIEWER'), { createdById: 'other' }, 'EDIT')).toBe('EDIT');
    expect(accessOf(me('EDITOR'), { createdById: 'other' }, 'VIEW')).toBe('VIEW');
  });
  it('denies projects that are neither created nor granted', () => {
    expect(accessOf(me('EDITOR'), { createdById: 'other' }, null)).toBeNull();
    expect(accessOf(me('EDITOR'), { createdById: null }, undefined)).toBeNull();
  });
});

/**
 * Topic `t1` and business `b1`, both created by `other`; `grant` is the caller's member row on
 * each, if any.
 */
function setup(grant: AccessLevel | null, meta: AccessScopeMeta | undefined) {
  const record = (id: string, want: string) =>
    id === want ? { createdById: 'other', members: grant ? [{ access: grant }] : [] } : null;
  const prisma = {
    topic: { findUnique: async ({ where }: { where: { id: string } }) => record(where.id, 't1') },
    business: {
      findUnique: async ({ where }: { where: { id: string } }) => record(where.id, 'b1'),
    },
    businessNote: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'n1' ? { businessId: 'b1' } : null,
    },
    idea: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'i1' ? { topicId: 't1' } : null,
    },
    tag: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'g1' ? { topicId: 't1' } : null,
    },
    campaign: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'k1' ? { topicId: 't1' } : null,
    },
    principle: { findUnique: async () => ({ topicId: null }) },
  } as unknown as PrismaService;
  const reflector = { get: () => meta } as unknown as Reflector;
  return new AccessGuard(reflector, new AccessService(prisma));
}

function ctx(method: string, role: Role, params: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ method, params, user: me(role) }) }),
  } as unknown as ExecutionContext;
}

describe('AccessGuard', () => {
  const onTopic: AccessScopeMeta = { via: 'topic', param: 'topicId' };
  const onIdea: AccessScopeMeta = { via: 'idea', param: 'id' };

  it('ignores routes without @TopicScoped', async () => {
    await expect(setup(null, undefined).canActivate(ctx('POST', 'VIEWER', {}))).resolves.toBe(true);
  });
  it('answers 404 without access', async () => {
    await expect(
      setup(null, onTopic).canActivate(ctx('GET', 'EDITOR', { topicId: 't1' })),
    ).rejects.toThrow(NotFoundException);
  });
  it('lets VIEW read but not write', async () => {
    const g = setup('VIEW', onIdea);
    await expect(g.canActivate(ctx('GET', 'EDITOR', { id: 'i1' }))).resolves.toBe(true);
    await expect(g.canActivate(ctx('PATCH', 'EDITOR', { id: 'i1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('lets a VIEWER account write with an EDIT grant', async () => {
    await expect(
      setup('EDIT', onTopic).canActivate(ctx('POST', 'VIEWER', { topicId: 't1' })),
    ).resolves.toBe(true);
  });
  it('honours an explicit need', async () => {
    await expect(
      setup('VIEW', { ...onTopic, need: 'EDIT' }).canActivate(
        ctx('GET', 'EDITOR', { topicId: 't1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('leaves missing records and global principles to the handler', async () => {
    await expect(
      setup(null, onIdea).canActivate(ctx('PATCH', 'EDITOR', { id: 'missing' })),
    ).resolves.toBe(true);
    await expect(
      setup(null, { via: 'principle', param: 'id' }).canActivate(
        ctx('PATCH', 'EDITOR', { id: 'p1' }),
      ),
    ).resolves.toBe(true);
  });
  it('applies the same rules to businesses and their records', async () => {
    const onNote: AccessScopeMeta = { via: 'businessNote', param: 'id' };
    await expect(
      setup(null, { via: 'business', param: 'id' }).canActivate(ctx('GET', 'EDITOR', { id: 'b1' })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      setup('VIEW', onNote).canActivate(ctx('GET', 'VIEWER', { id: 'n1' })),
    ).resolves.toBe(true);
    await expect(
      setup('VIEW', onNote).canActivate(ctx('DELETE', 'EDITOR', { id: 'n1' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      setup('EDIT', onNote).canActivate(ctx('DELETE', 'VIEWER', { id: 'n1' })),
    ).resolves.toBe(true);
  });
  it('guards tags and campaigns through their topic', async () => {
    const onTag: AccessScopeMeta = { via: 'tag', param: 'id' };
    const onCampaign: AccessScopeMeta = { via: 'campaign', param: 'id' };
    await expect(
      setup(null, onTag).canActivate(ctx('PATCH', 'EDITOR', { id: 'g1' })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      setup('VIEW', onTag).canActivate(ctx('DELETE', 'EDITOR', { id: 'g1' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      setup('EDIT', onCampaign).canActivate(ctx('PATCH', 'VIEWER', { id: 'k1' })),
    ).resolves.toBe(true);
  });
  it('lets admins through without looking anything up', async () => {
    await expect(
      setup(null, onTopic).canActivate(ctx('DELETE', 'ADMIN', { topicId: 'nope' })),
    ).resolves.toBe(true);
  });
});
