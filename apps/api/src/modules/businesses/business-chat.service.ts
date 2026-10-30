import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessChat as ChatRow, BusinessChatMessage as MessageRow } from '@prisma/client';
import {
  ApplyChatSchema,
  BUSINESS_CHAT_MAX_MESSAGES,
  BusinessChatDigestSchema,
  ChatPointSchema,
  SendChatMessageSchema,
  type ApplyChatInput,
  type BusinessChat,
  type SendChatMessageInput,
} from '@contenter/shared';
import { z } from 'zod';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';
import { BusinessNotesService } from './notes-assets.service';

type ChatWithMessages = ChatRow & { messages: MessageRow[] };

const PointsSchema = z.array(ChatPointSchema);

/**
 * The admin's conversation about a business profile (docs/75). One open conversation per
 * business. Talking changes nothing: AI replies (BUSINESS_CHAT, REPLY) and keeps the list of
 * what it understood. The admin then asks for a digest (BUSINESS_CHAT, DIGEST), edits it and
 * applies it, which creates an ordinary note and queues BUSINESS_REVISE.
 */
@Injectable()
export class BusinessChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly notes: BusinessNotesService,
  ) {}

  private toDto(chat: ChatWithMessages): BusinessChat {
    const digest = BusinessChatDigestSchema.safeParse(chat.digest);
    return {
      id: chat.id,
      businessId: chat.businessId,
      state: chat.state,
      messages: chat.messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        status: m.status,
        error: m.error,
        understood: PointsSchema.catch([]).parse(m.understood ?? []),
        questions: m.questions,
        conflicts: m.conflicts,
        createdAt: m.createdAt.toISOString(),
      })),
      digestStatus: chat.digestStatus as BusinessChat['digestStatus'],
      digestError: chat.digestError,
      digest: digest.success ? digest.data : null,
      digestUpTo: chat.digestUpTo,
      noteId: chat.noteId,
      createdAt: chat.createdAt.toISOString(),
    };
  }

  private async load(id: string): Promise<ChatWithMessages> {
    const chat = await this.prisma.businessChat.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!chat) throw new NotFoundException('Conversation not found');
    return chat;
  }

  private async open(id: string) {
    const chat = await this.load(id);
    if (chat.state !== 'OPEN') throw new BadRequestException('This conversation is closed');
    return chat;
  }

  /** The open conversation of the business, or null. */
  async current(businessId: string): Promise<BusinessChat | null> {
    const chat = await this.prisma.businessChat.findFirst({
      where: { businessId, state: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return chat ? this.toDto(chat) : null;
  }

  async send(businessId: string, input: SendChatMessageInput, user: AuthUser) {
    const { text } = SendChatMessageSchema.parse(input);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');

    const existing = await this.prisma.businessChat.findFirst({
      where: { businessId, state: 'OPEN' },
      include: { messages: { select: { status: true } } },
    });
    if (existing?.messages.some((m) => m.status === 'PENDING')) {
      throw new BadRequestException('AI is still answering; wait for the reply');
    }
    if (existing?.digestStatus === 'PENDING') {
      throw new BadRequestException('The digest is being written; wait for it to finish');
    }
    if ((existing?.messages.length ?? 0) >= BUSINESS_CHAT_MAX_MESSAGES) {
      throw new BadRequestException(
        'This conversation is long enough: write the digest and apply it, then start a new one',
      );
    }

    const chat =
      existing ??
      (await this.prisma.businessChat.create({
        data: { businessId, createdById: user.id },
        include: { messages: { select: { status: true } } },
      }));
    await this.prisma.businessChatMessage.create({
      data: { chatId: chat.id, role: 'USER', text, status: 'DONE' },
    });
    const id = await this.queueReply(chat.id, businessId, user);
    this.audit.log({
      userId: user.id,
      action: 'business.chat_message',
      entityType: 'Business',
      entityId: businessId,
      meta: { chatId: chat.id, chars: text.length },
    });
    return { id: chat.id, messageId: id };
  }

  /** Adds the empty assistant message and queues the job that fills it. */
  private async queueReply(chatId: string, businessId: string, user: AuthUser) {
    const slot = await this.prisma.businessChatMessage.create({
      data: { chatId, role: 'ASSISTANT', text: '', status: 'PENDING' },
    });
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_CHAT',
      targetType: 'Business',
      targetId: businessId,
      input: { chatId, messageId: slot.id, mode: 'REPLY' },
      userId: user.id,
    });
    await this.prisma.businessChatMessage.update({
      where: { id: slot.id },
      data: { jobId: job.id },
    });
    return slot.id;
  }

  /** Asks AI again after a failed reply (the failed slot is replaced). */
  async retry(id: string, user: AuthUser) {
    const chat = await this.open(id);
    const last = chat.messages.at(-1);
    if (!last || last.role !== 'ASSISTANT' || last.status !== 'FAILED') {
      throw new BadRequestException('There is no failed reply to retry');
    }
    await this.prisma.businessChatMessage.delete({ where: { id: last.id } });
    await this.queueReply(chat.id, chat.businessId, user);
    return { id: chat.id };
  }

  async requestDigest(id: string, user: AuthUser) {
    const chat = await this.open(id);
    if (chat.messages.some((m) => m.status === 'PENDING') || chat.digestStatus === 'PENDING') {
      throw new BadRequestException('AI is still working on this conversation');
    }
    if (!chat.messages.some((m) => m.role === 'USER' && m.status === 'DONE')) {
      throw new BadRequestException('Say something first');
    }
    const upTo = chat.messages.filter((m) => m.status !== 'PENDING').length;
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_CHAT',
      targetType: 'Business',
      targetId: chat.businessId,
      input: { chatId: chat.id, mode: 'DIGEST', upTo },
      userId: user.id,
    });
    await this.prisma.businessChat.update({
      where: { id },
      data: { digestStatus: 'PENDING', digestError: null, digestJobId: job.id },
    });
    return { id, jobId: job.id };
  }

  /**
   * Applies the (edited) digest: it becomes a standing-capable note and BUSINESS_REVISE runs
   * exactly as for a typed note. The conversation closes only after the note was accepted.
   */
  async apply(id: string, input: ApplyChatInput, user: AuthUser) {
    const data = ApplyChatSchema.parse(input);
    const chat = await this.open(id);
    if (chat.digestStatus !== 'DONE' || !chat.digest) {
      throw new BadRequestException('Write the digest of the conversation first');
    }
    const note = await this.notes.create(
      chat.businessId,
      {
        text: data.noteText,
        apply: data.apply,
        scope: data.scope,
        referenceIds: data.referenceIds,
        standing: data.standing,
      },
      user,
    );
    await this.prisma.businessChat.update({
      where: { id },
      data: { state: 'APPLIED', noteId: note.id },
    });
    this.audit.log({
      userId: user.id,
      action: 'business.chat_apply',
      entityType: 'Business',
      entityId: chat.businessId,
      meta: { chatId: id, noteId: note.id, messages: chat.messages.length },
    });
    return note;
  }

  async discard(id: string, user: AuthUser) {
    const chat = await this.open(id);
    await this.prisma.businessChat.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'business.chat_discard',
      entityType: 'Business',
      entityId: chat.businessId,
      meta: { chatId: id, messages: chat.messages.length },
    });
  }
}
