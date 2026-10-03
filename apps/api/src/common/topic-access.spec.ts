import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { Role, TopicAccess } from '@contenter/shared';
import type { PrismaService } from '../infra/prisma/prisma.service';
import {
  accessOf,
  TopicAccessGuard,
  TopicAccessService,
  type TopicScopeMeta,
} from './topic-access';

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

/** One project `t1` created by `other`; `grant` is the caller's TopicMember row, if any. */
function setup(grant: TopicAccess | null, meta: TopicScopeMeta | undefined) {
  const prisma = {
    topic: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 't1'
          ? { createdById: 'other', members: grant ? [{ access: grant }] : [] }
          : null,
    },
    idea: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'i1' ? { topicId: 't1' } : null,
    },
    principle: { findUnique: async () => ({ topicId: null }) },
  } as unknown as PrismaService;
  const reflector = { get: () => meta } as unknown as Reflector;
  return new TopicAccessGuard(reflector, new TopicAccessService(prisma));
}

function ctx(method: string, role: Role, params: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ method, params, user: me(role) }) }),
  } as unknown as ExecutionContext;
}

describe('TopicAccessGuard', () => {
  const onTopic: TopicScopeMeta = { via: 'topic', param: 'topicId' };
  const onIdea: TopicScopeMeta = { via: 'idea', param: 'id' };

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
  it('lets admins through without looking anything up', async () => {
    await expect(
      setup(null, onTopic).canActivate(ctx('DELETE', 'ADMIN', { topicId: 'nope' })),
    ).resolves.toBe(true);
  });
});
