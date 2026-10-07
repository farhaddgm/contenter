import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ContentComment, CreateCommentInput, UpdateCommentInput } from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../../common/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const COMMENT_INCLUDE = {
  author: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  version: { select: { version: true } },
} satisfies Prisma.ContentCommentInclude;

type CommentRow = Prisma.ContentCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

function toDto(row: CommentRow): ContentComment {
  const { version, ...rest } = row;
  return {
    ...rest,
    version: version?.version ?? null,
    resolvedAt: rest.resolvedAt?.toISOString() ?? null,
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
  };
}

/** Comments on a draft: top-level threads with one level of replies (docs/21-review-workflow.md). */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Threads oldest first, each with its replies oldest first. */
  async list(contentId: string): Promise<ContentComment[]> {
    const rows = await this.prisma.contentComment.findMany({
      where: { contentId },
      orderBy: { createdAt: 'asc' },
      include: COMMENT_INCLUDE,
    });
    const dtos = rows.map(toDto);
    const threads = dtos
      .filter((c) => !c.parentId)
      .map((c) => ({ ...c, replies: [] as ContentComment[] }));
    const byId = new Map(threads.map((t) => [t.id, t]));
    for (const reply of dtos.filter((c) => c.parentId))
      byId.get(reply.parentId!)?.replies.push(reply);
    return threads;
  }

  async create(contentId: string, input: CreateCommentInput, user: AuthUser) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        currentVersionId: true,
        title: true,
        topicId: true,
        createdById: true,
        submittedById: true,
      },
    });
    if (!content) throw new NotFoundException('Content not found');

    let versionId = input.versionId ?? content.currentVersionId;
    if (input.versionId) {
      const version = await this.prisma.contentVersion.findFirst({
        where: { id: input.versionId, contentId },
        select: { id: true },
      });
      if (!version) throw new BadRequestException('Version does not belong to this content');
    }

    if (input.parentId) {
      const parent = await this.prisma.contentComment.findFirst({
        where: { id: input.parentId, contentId },
        select: { parentId: true, versionId: true },
      });
      if (!parent) throw new BadRequestException('Parent comment does not belong to this content');
      if (parent.parentId) throw new BadRequestException('Replies cannot be nested');
      // a reply stays on the version its thread is about
      versionId = parent.versionId;
    }

    const row = await this.prisma.contentComment.create({
      data: {
        contentId,
        versionId,
        parentId: input.parentId ?? null,
        authorId: user.id,
        body: input.body,
      },
      include: COMMENT_INCLUDE,
    });
    this.audit.log({
      userId: user.id,
      action: input.parentId ? 'content.comment_reply' : 'content.comment',
      entityType: 'Content',
      entityId: contentId,
      meta: { commentId: row.id },
    });
    try {
      await this.tell(contentId, content, input, user);
    } catch (err) {
      this.logger.warn(`could not notify about a comment: ${(err as Error).message}`);
    }
    return toDto(row);
  }

  /** A new thread tells the people around the content; a reply tells the thread and them. */
  private async tell(
    contentId: string,
    content: {
      title: string;
      topicId: string;
      createdById: string | null;
      submittedById: string | null;
    },
    input: CreateCommentInput,
    user: AuthUser,
  ) {
    // the people who already spoke on this thread (or, for a new thread, anywhere on the content)
    const earlier = await this.prisma.contentComment.findMany({
      where: input.parentId
        ? { OR: [{ id: input.parentId }, { parentId: input.parentId }] }
        : { contentId },
      select: { authorId: true },
    });
    const recipients = await this.notifications.participantsOf(
      { id: contentId, ...content },
      earlier.map((c) => c.authorId),
    );
    await this.notifications.notify({
      event: input.parentId ? 'COMMENT_REPLIED' : 'COMMENT_ADDED',
      recipients,
      actor: { id: user.id },
      content: { id: contentId, title: content.title, topicId: content.topicId },
      note: input.body,
    });
  }

  async update(id: string, input: UpdateCommentInput, user: AuthUser) {
    const comment = await this.prisma.contentComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (input.body !== undefined && comment.authorId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only the author can edit a comment');
    }
    if (input.resolved !== undefined && comment.parentId) {
      throw new BadRequestException('Only a top-level comment can be resolved');
    }
    const row = await this.prisma.contentComment.update({
      where: { id },
      data: {
        body: input.body,
        ...(input.resolved === undefined
          ? {}
          : input.resolved
            ? {
                resolvedAt: comment.resolvedAt ?? new Date(),
                resolvedById: comment.resolvedById ?? user.id,
              }
            : { resolvedAt: null, resolvedById: null }),
      },
      include: COMMENT_INCLUDE,
    });
    this.audit.log({
      userId: user.id,
      action: input.resolved === undefined ? 'content.comment_edit' : 'content.comment_resolve',
      entityType: 'Content',
      entityId: comment.contentId,
      meta: { commentId: id, resolved: input.resolved },
    });
    return toDto(row);
  }

  /** The author (or an admin) removes a comment; a thread takes its replies with it. */
  async remove(id: string, user: AuthUser) {
    const comment = await this.prisma.contentComment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Only the author can delete a comment');
    }
    await this.prisma.contentComment.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'content.comment_delete',
      entityType: 'Content',
      entityId: comment.contentId,
      meta: { commentId: id },
    });
  }
}
