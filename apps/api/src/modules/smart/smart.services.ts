import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  SendSmartMessageInput,
  StartConversationInput,
  UpdateIssueInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { paginate, toPage } from '../../common/pagination';
import type { AuthUser } from '../../common/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { AiJobsService } from '../ai/ai-jobs.service';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** First Markdown heading (or first non-empty line), stripped of Markdown syntax. */
export function extractTitle(markdown: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+)$/m.exec(markdown)?.[1];
  const firstLine = markdown.split('\n').find((l) => l.trim().length > 0) ?? '';
  const raw = (heading ?? firstLine)
    .replace(/[*_`>#]/g, '')
    .replace(/^\s*(عنوان|title)\s*[:：]\s*/i, '')
    .trim();
  return clip(raw || 'بدون عنوان', 150);
}

// ───────────────────────────── conversations ─────────────────────────────

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobsService,
  ) {}

  async start(input: StartConversationInput, user: AuthUser) {
    let title = '';
    if (input.kind === 'ERROR') {
      if (!input.errorId)
        throw new BadRequestException('errorId is required for error conversations');
      const err = await this.prisma.appError.findUnique({ where: { id: input.errorId } });
      if (!err) throw new NotFoundException('Error not found');
      title = clip(err.message, 120);
    }
    return this.prisma.smartConversation.create({
      data: {
        userId: user.id,
        kind: input.kind,
        title,
        errorId: input.errorId ?? null,
        topicId: input.topicId ?? null,
        route: input.route ?? null,
      },
    });
  }

  list(userId: string, kind?: 'WALKER' | 'ERROR', errorId?: string) {
    return this.prisma.smartConversation.findMany({
      where: { userId, ...(kind ? { kind } : {}), ...(errorId ? { errorId } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
  }

  async get(id: string, user: AuthUser) {
    const conv = await this.prisma.smartConversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { issues: { select: { id: true }, take: 1 } },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== user.id) throw new ForbiddenException();
    const jobIds = conv.messages.map((m) => m.jobId).filter((x): x is string => !!x);
    const jobs = jobIds.length
      ? await this.prisma.aiJob.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, status: true },
        })
      : [];
    const jobStatus = new Map(jobs.map((j) => [j.id, j.status]));
    return {
      ...conv,
      messages: conv.messages.map(({ issues, ...m }) => ({
        ...m,
        jobStatus: m.jobId ? (jobStatus.get(m.jobId) ?? null) : null,
        issueId: issues[0]?.id ?? null,
      })),
    };
  }

  /** Stores the admin's message and queues the assistant reply as a SMART_CHAT AI job. */
  async send(id: string, input: SendSmartMessageInput, user: AuthUser) {
    const conv = await this.prisma.smartConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== user.id) throw new ForbiddenException();
    const pending = await this.prisma.smartMessage.count({
      where: { conversationId: id, role: 'ASSISTANT', status: 'PENDING' },
    });
    if (pending)
      throw new BadRequestException('The assistant is still answering the previous message');

    const topicId = input.topicId ?? conv.topicId ?? null;
    const context = { route: input.route ?? null, topicId, walkerStep: input.walkerStep ?? null };
    const { assistant } = await this.prisma.$transaction(async (tx) => {
      await tx.smartMessage.create({
        data: {
          conversationId: id,
          role: 'USER',
          content: input.content,
          context: context as Prisma.InputJsonValue,
        },
      });
      const assistant = await tx.smartMessage.create({
        data: {
          conversationId: id,
          role: 'ASSISTANT',
          status: 'PENDING',
          context: context as Prisma.InputJsonValue,
        },
      });
      await tx.smartConversation.update({
        where: { id },
        data: {
          title: conv.title || clip(input.content.replace(/\s+/g, ' '), 120),
          topicId,
          route: input.route ?? conv.route,
        },
      });
      return { assistant };
    });

    const job = await this.jobs.enqueue({
      type: 'SMART_CHAT',
      targetType: 'SmartMessage',
      targetId: assistant.id,
      topicId,
      input: { conversationId: id },
      userId: user.id,
    });
    await this.prisma.smartMessage.update({ where: { id: assistant.id }, data: { jobId: job.id } });
    return { jobId: job.id, messageId: assistant.id };
  }

  async remove(id: string, user: AuthUser) {
    const conv = await this.prisma.smartConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userId !== user.id) throw new ForbiddenException();
    await this.prisma.smartConversation.delete({ where: { id } });
  }
}

// ───────────────────────────── walker issues ─────────────────────────────

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Saves an assistant message verbatim to "دفتر خطاهای واکر". */
  async saveFromMessage(messageId: string, user: AuthUser) {
    const message = await this.prisma.smartMessage.findUnique({
      where: { id: messageId },
      include: {
        conversation: { include: { error: true } },
        issues: { select: { id: true }, take: 1 },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.conversation.userId !== user.id) throw new ForbiddenException();
    if (message.role !== 'ASSISTANT' || message.status !== 'DONE' || !message.content.trim()) {
      throw new BadRequestException('Only a completed assistant message can be saved');
    }
    if (message.issues[0]) return this.get(message.issues[0].id);

    const conv = message.conversation;
    const msgContext = (message.context ?? {}) as {
      route?: string;
      topicId?: string;
      walkerStep?: string;
    };
    const issue = await this.prisma.walkerIssue.create({
      data: {
        title: extractTitle(message.content),
        content: message.content,
        source: conv.kind === 'ERROR' ? 'ERROR_CHAT' : 'WALKER_CHAT',
        conversationId: conv.id,
        messageId: message.id,
        errorId: conv.errorId,
        topicId: msgContext.topicId ?? conv.topicId,
        route: msgContext.route ?? conv.route,
        context: {
          conversationTitle: conv.title,
          walkerStep: msgContext.walkerStep ?? null,
          error: conv.error
            ? {
                id: conv.error.id,
                message: conv.error.message,
                source: conv.error.source,
                category: conv.error.category,
              }
            : null,
          savedFromMessageAt: message.createdAt.toISOString(),
        } as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
    this.audit.log({
      userId: user.id,
      action: 'walker_issue.create',
      entityType: 'WalkerIssue',
      entityId: issue.id,
    });
    return this.get(issue.id);
  }

  async list(query: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.WalkerIssueWhereInput = {
      ...(query.status ? { status: query.status as Prisma.WalkerIssueWhereInput['status'] } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { content: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.walkerIssue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true } } },
        ...paginate(query),
      }),
      this.prisma.walkerIssue.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  async get(id: string) {
    const issue = await this.prisma.walkerIssue.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  async update(id: string, input: UpdateIssueInput, user: AuthUser) {
    const data: Prisma.WalkerIssueUpdateInput = { ...input };
    if (input.status) data.resolvedAt = input.status === 'RESOLVED' ? new Date() : null;
    await this.prisma.walkerIssue.update({ where: { id }, data });
    this.audit.log({
      userId: user.id,
      action: 'walker_issue.update',
      entityType: 'WalkerIssue',
      entityId: id,
      meta: input,
    });
    return this.get(id);
  }

  async remove(id: string, user: AuthUser) {
    await this.prisma.walkerIssue.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'walker_issue.delete',
      entityType: 'WalkerIssue',
      entityId: id,
    });
  }

  countOpen() {
    return this.prisma.walkerIssue.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } });
  }
}
