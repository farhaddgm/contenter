import { BadRequestException, Injectable } from '@nestjs/common';
import {
  answerableSection,
  buildProfileQuestions,
  isWriteBlocked,
  parseClaims,
  peakingSoon,
  unprovenClaims,
  type AnswerProfileQuestionInput,
  type BusinessSectionKey,
  type ProfileQuestionList,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { writeSection } from './section-writer';

/**
 * The questions that fill the gaps of a profile (docs/72). Everything here is read and counted by
 * code; an answer is appended, in the admin's own words, to the section it belongs to through
 * `writeSection` (so the section lock applies). No model is involved.
 */
@Injectable()
export class ProfileQuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(businessId: string, user: AuthUser, now = new Date()): Promise<ProfileQuestionList> {
    const usable = { businessId, isActive: true, verified: true };
    const [sections, facts, competitors, offerings, skips] = await Promise.all([
      this.prisma.businessSection.findMany({
        where: { businessId },
        select: { key: true, content: true, source: true, reviewedAt: true, updatedAt: true, lock: true },
      }),
      this.prisma.businessFact.count({ where: { businessId, isActive: true } }),
      this.prisma.businessCompetitor.count({ where: { businessId, isActive: true } }),
      this.prisma.businessOffering.findMany({
        where: usable,
        select: { claims: true, status: true, stock: true, peakMonths: true, availableFrom: true, availableUntil: true },
      }),
      this.prisma.businessQuestionSkip.findMany({ where: { businessId }, select: { code: true } }),
    ]);
    const claims = offerings.map((o) => parseClaims(o.claims));
    const blocked = sections
      .filter((s) => isWriteBlocked(s.lock, { kind: 'USER', role: user.role }))
      .map((s) => s.key);
    return buildProfileQuestions({
      sections,
      counts: {
        facts,
        competitors,
        offerings: offerings.length,
        offeringsWithoutClaims: claims.filter((c) => c.length === 0).length,
        unprovenClaims: claims.reduce((n, c) => n + unprovenClaims(c), 0),
        peakSoon: peakingSoon(offerings, now).length,
      },
      skipped: skips.map((s) => s.code),
      blocked,
      now,
    });
  }

  /** Appends the answer to the question's section; only the section questions can be answered here. */
  async answer(businessId: string, input: AnswerProfileQuestionInput, user: AuthUser) {
    const key: BusinessSectionKey | null = answerableSection(input.code);
    if (!key) throw new BadRequestException('This question is answered where its data is entered');
    const answer = input.answer.trim();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.businessSection.findUnique({
        where: { businessId_key: { businessId, key } },
        select: { content: true },
      });
      const current = existing?.content.trim() ?? '';
      return writeSection(tx, {
        businessId,
        key,
        content: current ? `${current}\n\n${answer}` : answer,
        source: 'ADMIN',
        userId: user.id,
        actor: { kind: 'USER', role: user.role },
      });
    });
    // the answer text stays out of the audit log
    this.audit.log({
      userId: user.id,
      action: 'business.question_answer',
      entityType: 'Business',
      entityId: businessId,
      meta: { code: input.code },
    });
    return this.list(businessId, user);
  }

  async skip(businessId: string, code: string, user: AuthUser) {
    await this.prisma.businessQuestionSkip.upsert({
      where: { businessId_code: { businessId, code } },
      create: { businessId, code },
      update: {},
    });
    this.audit.log({
      userId: user.id,
      action: 'business.question_skip',
      entityType: 'Business',
      entityId: businessId,
      meta: { code },
    });
    return this.list(businessId, user);
  }

  async resetSkips(businessId: string, user: AuthUser) {
    await this.prisma.businessQuestionSkip.deleteMany({ where: { businessId } });
    return this.list(businessId, user);
  }
}
