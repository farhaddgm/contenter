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
import type { AccessLevel } from '@contenter/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import type { AuthUser } from './auth.decorators';

/**
 * Per-topic and per-business access (docs/17-project-access.md). Admins see and edit everything.
 * EDITOR and VIEWER accounts only reach topics/businesses they created (EDIT) or that the owner
 * granted (`TopicMember` / `BusinessMember`, VIEW or EDIT); a grant overrides the creator default.
 * No access answers 404, read-only answers 403.
 */

export type AccessKind = 'topic' | 'business';

/** Which record a route parameter points at; each belongs to exactly one topic or business. */
export type TopicVia =
  'topic' | 'sample' | 'idea' | 'content' | 'profile' | 'trait' | 'brandDoc' | 'principle';
export type BusinessVia =
  | 'business'
  | 'businessReference'
  | 'businessRevision'
  | 'businessSuggestion'
  | 'businessNote'
  | 'businessAsset'
  | 'businessFact'
  | 'businessTerm'
  | 'businessAudit';

export interface AccessScopeMeta {
  via: TopicVia | BusinessVia;
  param: string;
  /** Defaults to VIEW for GET and EDIT for everything else. */
  need?: AccessLevel;
}

export const ACCESS_SCOPE_KEY = 'accessScope';

/** Guards a route by the caller's access to the topic its `param` belongs to. */
export const TopicScoped = (via: TopicVia, param = 'id', need?: AccessLevel) =>
  SetMetadata(ACCESS_SCOPE_KEY, { via, param, need } satisfies AccessScopeMeta);

/** Guards a route by the caller's access to the business its `param` belongs to. */
export const BusinessScoped = (via: BusinessVia, param = 'id', need?: AccessLevel) =>
  SetMetadata(ACCESS_SCOPE_KEY, { via, param, need } satisfies AccessScopeMeta);

/** Effective access from the creator default and an optional explicit grant. */
export function accessOf(
  user: Pick<AuthUser, 'id' | 'role'>,
  record: { createdById: string | null },
  grant: AccessLevel | null | undefined,
): AccessLevel | null {
  if (user.role === 'ADMIN') return 'EDIT';
  if (grant) return grant;
  return record.createdById === user.id ? 'EDIT' : null;
}

type Target = { kind: AccessKind; id: string | null };

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prisma filter for the topics a user can see; undefined = all (admin). */
  visibleTopics(user: AuthUser): Prisma.TopicWhereInput | undefined {
    if (user.role === 'ADMIN') return undefined;
    return { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] };
  }

  /** Prisma filter for the businesses a user can see; undefined = all (admin). */
  visibleBusinesses(user: AuthUser): Prisma.BusinessWhereInput | undefined {
    if (user.role === 'ADMIN') return undefined;
    return { OR: [{ createdById: user.id }, { members: { some: { userId: user.id } } }] };
  }

  /** Include for topic/business queries so `withAccess` can compute the caller's access. */
  memberInclude(user: AuthUser) {
    return { members: { where: { userId: user.id }, select: { access: true } } } as const;
  }

  /** Adds `access` to a record loaded with `memberInclude` and drops the member rows. */
  withAccess<T extends { createdById: string | null; members?: { access: AccessLevel }[] }>(
    user: AuthUser,
    record: T,
  ): Omit<T, 'members'> & { access: AccessLevel | null } {
    const { members, ...rest } = record;
    return { ...rest, access: accessOf(user, record, members?.[0]?.access) };
  }

  async accessTo(user: AuthUser, kind: AccessKind, id: string): Promise<AccessLevel | null> {
    if (user.role === 'ADMIN') return 'EDIT';
    const select = { createdById: true, ...this.memberInclude(user) };
    const record =
      kind === 'topic'
        ? await this.prisma.topic.findUnique({ where: { id }, select })
        : await this.prisma.business.findUnique({ where: { id }, select });
    return record ? accessOf(user, record, record.members[0]?.access) : null;
  }

  /** Throws 404 without access and 403 when EDIT is needed but only VIEW is granted. */
  async assert(user: AuthUser, kind: AccessKind, id: string, need: AccessLevel) {
    const access = await this.accessTo(user, kind, id);
    if (!access) throw new NotFoundException('Not found');
    if (need === 'EDIT' && access !== 'EDIT') {
      throw new ForbiddenException(`Read-only access to this ${kind}`);
    }
  }

  /** The topic or business a record belongs to; undefined when the record does not exist. */
  async targetOf(via: AccessScopeMeta['via'], id: string): Promise<Target | undefined> {
    const p = this.prisma;
    const topic = (r: { topicId: string | null } | null) =>
      r ? { kind: 'topic' as const, id: r.topicId } : undefined;
    const business = (r: { businessId: string } | null) =>
      r ? { kind: 'business' as const, id: r.businessId } : undefined;
    const sel = { select: { topicId: true } } as const;
    const bsel = { select: { businessId: true } } as const;
    switch (via) {
      case 'topic':
        return { kind: 'topic', id };
      case 'sample':
        return topic(await p.sampleContent.findUnique({ where: { id }, ...sel }));
      case 'idea':
        return topic(await p.idea.findUnique({ where: { id }, ...sel }));
      case 'content':
        return topic(await p.content.findUnique({ where: { id }, ...sel }));
      case 'profile':
        return topic(await p.contentProfile.findUnique({ where: { id }, ...sel }));
      case 'trait': {
        const t = await p.profileTrait.findUnique({
          where: { id },
          select: { profile: { select: { topicId: true } } },
        });
        return topic(t?.profile ?? null);
      }
      case 'brandDoc':
        return topic(await p.brandDocument.findUnique({ where: { id }, ...sel }));
      case 'principle':
        // null topic = a global principle; those are admin-only and checked by the service
        return topic(await p.principle.findUnique({ where: { id }, ...sel }));
      case 'business':
        return { kind: 'business', id };
      case 'businessReference':
        return business(await p.businessReference.findUnique({ where: { id }, ...bsel }));
      case 'businessRevision': {
        const r = await p.businessSectionRevision.findUnique({
          where: { id },
          select: { section: { select: { businessId: true } } },
        });
        return business(r?.section ?? null);
      }
      case 'businessSuggestion':
        return business(await p.businessSuggestion.findUnique({ where: { id }, ...bsel }));
      case 'businessNote':
        return business(await p.businessNote.findUnique({ where: { id }, ...bsel }));
      case 'businessAsset':
        return business(await p.businessAsset.findUnique({ where: { id }, ...bsel }));
      case 'businessFact':
        return business(await p.businessFact.findUnique({ where: { id }, ...bsel }));
      case 'businessTerm':
        return business(await p.businessTerm.findUnique({ where: { id }, ...bsel }));
      case 'businessAudit':
        return business(await p.businessAudit.findUnique({ where: { id }, ...bsel }));
    }
  }
}

/** Runs after RolesGuard on routes marked with `@TopicScoped` / `@BusinessScoped`. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<AccessScopeMeta | undefined>(
      ACCESS_SCOPE_KEY,
      ctx.getHandler(),
    );
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!meta || !user || user.role === 'ADMIN') return true;
    const id = req.params?.[meta.param] as string | undefined;
    if (!id) return true;
    const target = await this.access.targetOf(meta.via, id);
    // missing record → the handler answers 404; global principle → the service checks the role
    if (!target?.id) return true;
    await this.access.assert(
      user,
      target.kind,
      target.id,
      meta.need ?? (req.method === 'GET' ? 'VIEW' : 'EDIT'),
    );
    return true;
  }
}

@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
