import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Global,
  Injectable,
  Module,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import type { TopicAccess } from '@contenter/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { AuthUser } from './auth.decorators';

/**
 * Per-project access (docs/17-project-access.md). Admins see and edit every project. EDITOR and
 * VIEWER accounts only reach projects they created (EDIT) or were granted (`TopicMember`, VIEW or
 * EDIT); a grant overrides the creator default. No access answers 404, read-only answers 403.
 */

/** Which record the route parameter points at; each one belongs to exactly one project. */
export type TopicVia =
  'topic' | 'sample' | 'idea' | 'content' | 'profile' | 'trait' | 'brandDoc' | 'principle';

export interface TopicScopeMeta {
  via: TopicVia;
  param: string;
  /** Defaults to VIEW for GET and EDIT for everything else. */
  need?: TopicAccess;
}

export const TOPIC_SCOPE_KEY = 'topicScope';

/** Guards a route by the caller's access to the project its `param` belongs to. */
export const TopicScoped = (via: TopicVia, param = 'id', need?: TopicAccess) =>
  SetMetadata(TOPIC_SCOPE_KEY, { via, param, need } satisfies TopicScopeMeta);

/** Effective access from the creator default and an optional explicit grant. */
export function accessOf(
  user: Pick<AuthUser, 'id' | 'role'>,
  topic: { createdById: string | null },
  grant: TopicAccess | null | undefined,
): TopicAccess | null {
  if (user.role === 'ADMIN') return 'EDIT';
  if (grant) return grant;
  return topic.createdById === user.id ? 'EDIT' : null;
}

@Injectable()
export class TopicAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma filter for the projects a user can see; undefined = all (admin). */
  visibleWhere(user: AuthUser): Prisma.TopicWhereInput | undefined {
    if (user.role === 'ADMIN') return undefined;
    return { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] };
  }

  /** Include for topic queries so `withAccess` can compute the caller's access. */
  memberInclude(user: AuthUser) {
    return { members: { where: { userId: user.id }, select: { access: true } } } as const;
  }

  /** Adds `access` to a topic loaded with `memberInclude` and drops the member rows. */
  withAccess<T extends { createdById: string | null; members?: { access: TopicAccess }[] }>(
    user: AuthUser,
    topic: T,
  ): Omit<T, 'members'> & { access: TopicAccess | null } {
    const { members, ...rest } = topic;
    return { ...rest, access: accessOf(user, topic, members?.[0]?.access) };
  }

  async accessTo(user: AuthUser, topicId: string): Promise<TopicAccess | null> {
    if (user.role === 'ADMIN') return 'EDIT';
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { createdById: true, ...this.memberInclude(user) },
    });
    return topic ? accessOf(user, topic, topic.members[0]?.access) : null;
  }

  /** Throws 404 without access and 403 when EDIT is needed but only VIEW is granted. */
  async assert(user: AuthUser, topicId: string, need: TopicAccess) {
    const access = await this.accessTo(user, topicId);
    if (!access) throw new NotFoundException('Not found');
    if (need === 'EDIT' && access !== 'EDIT') {
      throw new ForbiddenException('Read-only access to this project');
    }
  }

  /** The project a record belongs to; undefined when the record does not exist. */
  async topicIdOf(via: TopicVia, id: string): Promise<string | null | undefined> {
    const p = this.prisma;
    switch (via) {
      case 'topic':
        return id;
      case 'sample':
        return (await p.sampleContent.findUnique({ where: { id }, select: { topicId: true } }))
          ?.topicId;
      case 'idea':
        return (await p.idea.findUnique({ where: { id }, select: { topicId: true } }))?.topicId;
      case 'content':
        return (await p.content.findUnique({ where: { id }, select: { topicId: true } }))?.topicId;
      case 'profile':
        return (await p.contentProfile.findUnique({ where: { id }, select: { topicId: true } }))
          ?.topicId;
      case 'trait':
        return (
          await p.profileTrait.findUnique({
            where: { id },
            select: { profile: { select: { topicId: true } } },
          })
        )?.profile.topicId;
      case 'brandDoc':
        return (await p.brandDocument.findUnique({ where: { id }, select: { topicId: true } }))
          ?.topicId;
      case 'principle':
        // null = a global principle; those are admin-only and checked by the service
        return (await p.principle.findUnique({ where: { id }, select: { topicId: true } }))
          ?.topicId;
    }
  }
}

/** Runs after RolesGuard on routes marked with `@TopicScoped`. */
@Injectable()
export class TopicAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: TopicAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<TopicScopeMeta | undefined>(TOPIC_SCOPE_KEY, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!meta || !user || user.role === 'ADMIN') return true;
    const id = req.params?.[meta.param] as string | undefined;
    if (!id) return true;
    const topicId = await this.access.topicIdOf(meta.via, id);
    // missing record → the handler answers 404; global principle → the service checks the role
    if (!topicId) return true;
    await this.access.assert(user, topicId, meta.need ?? (req.method === 'GET' ? 'VIEW' : 'EDIT'));
    return true;
  }
}

@Global()
@Module({
  providers: [TopicAccessService],
  exports: [TopicAccessService],
})
export class TopicAccessModule {}
