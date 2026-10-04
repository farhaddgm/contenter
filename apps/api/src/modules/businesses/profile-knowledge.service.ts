import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BusinessAudit as AuditRow, Prisma } from '@prisma/client';
import {
  BUSINESS_FACT_LIMIT,
  BUSINESS_TERM_LIMIT,
  CreateBusinessFactSchema,
  CreateBusinessTermSchema,
  UpdateBusinessFactSchema,
  UpdateBusinessTermSchema,
  type AuditIssue,
  type BusinessSectionKey,
  type CreateBusinessFactInput,
  type CreateBusinessTermInput,
  type FixAuditIssueInput,
  type UpdateBusinessFactInput,
  type UpdateBusinessTermInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';
import { BusinessNotesService } from './notes-assets.service';

const USER_REF = { select: { id: true, name: true } } as const;
const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/** `YYYY-MM-DD` / '' / null from the API → a DB date (end of that day is not needed: day compare). */
const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v ? new Date(`${v}T00:00:00.000Z`) : null;

/** Wording of the note an audit fix creates (shown in the notes history), per business language. */
const AUDIT_NOTE_WORDS: Record<string, { issue: string; section: string; fix: string }> = {
  fa: { issue: 'مشکل بررسی کیفیت', section: 'بخش', fix: 'راه رفع' },
  en: { issue: 'Profile audit issue', section: 'section', fix: 'Fix' },
};

/** Stored audit issues (JSON) → typed list. */
export const auditIssues = (a: Pick<AuditRow, 'issues'>) =>
  (Array.isArray(a.issues) ? a.issues : []) as unknown as AuditIssue[];

/**
 * The knowledge layers of a business profile besides its sections (docs/16): section review,
 * key facts, brand terminology and the AI profile audit. AI work is only queued here.
 */
@Injectable()
export class ProfileKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly notes: BusinessNotesService,
  ) {}

  private async business(id: string) {
    const b = await this.prisma.business.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Business not found');
    return b;
  }

  private log(user: AuthUser, action: string, businessId: string, meta?: unknown) {
    this.audit.log({
      userId: user.id,
      action,
      entityType: 'Business',
      entityId: businessId,
      meta: meta as Record<string, unknown> | undefined,
    });
  }

  // ---------- section review ----------

  /** The admin confirms the current text of a section (typically an AI draft). */
  async reviewSection(id: string, key: BusinessSectionKey, user: AuthUser) {
    const section = await this.prisma.businessSection.findUnique({
      where: { businessId_key: { businessId: id, key } },
    });
    if (!section?.content.trim()) throw new BadRequestException('The section is empty');
    const updated = await this.prisma.businessSection.update({
      where: { id: section.id },
      data: { reviewedAt: new Date(), reviewedById: user.id },
      include: { updatedBy: USER_REF, reviewedBy: USER_REF },
    });
    this.log(user, 'business.section_review', id, { key });
    return updated;
  }

  // ---------- key facts ----------

  facts(businessId: string) {
    return this.prisma.businessFact.findMany({
      where: { businessId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { updatedBy: USER_REF },
    });
  }

  async createFact(businessId: string, input: CreateBusinessFactInput, user: AuthUser) {
    await this.business(businessId);
    const data = CreateBusinessFactSchema.parse(input);
    if ((await this.prisma.businessFact.count({ where: { businessId } })) >= BUSINESS_FACT_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_FACT_LIMIT} facts`);
    }
    const fact = await this.prisma.businessFact.create({
      data: {
        ...data,
        validUntil: toDate(data.validUntil) ?? null,
        businessId,
        source: 'ADMIN',
        verified: true,
        updatedById: user.id,
      },
      include: { updatedBy: USER_REF },
    });
    this.log(user, 'business.fact_create', businessId, { factId: fact.id, label: fact.label });
    return fact;
  }

  private async fact(id: string) {
    const fact = await this.prisma.businessFact.findUnique({ where: { id } });
    if (!fact) throw new NotFoundException('Fact not found');
    return fact;
  }

  async updateFact(id: string, input: UpdateBusinessFactInput, user: AuthUser) {
    const fact = await this.fact(id);
    const data = UpdateBusinessFactSchema.parse(input);
    const edited = data.value !== undefined && data.value !== fact.value;
    const updated = await this.prisma.businessFact.update({
      where: { id },
      data: {
        ...data,
        validUntil: toDate(data.validUntil),
        // A person typing a new value vouches for it.
        ...(edited ? { source: 'ADMIN', verified: data.verified ?? true } : {}),
        updatedById: user.id,
      },
      include: { updatedBy: USER_REF },
    });
    this.log(user, 'business.fact_update', fact.businessId, { factId: id, ...input });
    return updated;
  }

  async removeFact(id: string, user: AuthUser) {
    const fact = await this.fact(id);
    await this.prisma.businessFact.delete({ where: { id } });
    this.log(user, 'business.fact_delete', fact.businessId, { factId: id, label: fact.label });
  }

  // ---------- terminology ----------

  terms(businessId: string) {
    return this.prisma.businessTerm.findMany({
      where: { businessId },
      orderBy: [{ kind: 'asc' }, { term: 'asc' }],
    });
  }

  async createTerm(businessId: string, input: CreateBusinessTermInput, user: AuthUser) {
    await this.business(businessId);
    const data = CreateBusinessTermSchema.parse(input);
    if ((await this.prisma.businessTerm.count({ where: { businessId } })) >= BUSINESS_TERM_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_TERM_LIMIT} terms`);
    }
    const dup = await this.prisma.businessTerm.findFirst({
      where: { businessId, term: { equals: data.term, mode: 'insensitive' } },
    });
    if (dup) throw new BadRequestException('This term is already in the list');
    const term = await this.prisma.businessTerm.create({
      data: { ...data, alternatives: dedupe(data.alternatives), businessId },
    });
    this.log(user, 'business.term_create', businessId, { termId: term.id, term: term.term });
    return term;
  }

  private async term(id: string) {
    const term = await this.prisma.businessTerm.findUnique({ where: { id } });
    if (!term) throw new NotFoundException('Term not found');
    return term;
  }

  async updateTerm(id: string, input: UpdateBusinessTermInput, user: AuthUser) {
    const term = await this.term(id);
    const data = UpdateBusinessTermSchema.parse(input);
    const updated = await this.prisma.businessTerm.update({
      where: { id },
      data: {
        ...data,
        ...(data.alternatives ? { alternatives: dedupe(data.alternatives) } : {}),
      },
    });
    this.log(user, 'business.term_update', term.businessId, { termId: id, ...input });
    return updated;
  }

  async removeTerm(id: string, user: AuthUser) {
    const term = await this.term(id);
    await this.prisma.businessTerm.delete({ where: { id } });
    this.log(user, 'business.term_delete', term.businessId, { termId: id, term: term.term });
  }

  // ---------- AI profile audit ----------

  /** Latest audit (running or finished), or null. */
  latestAudit(businessId: string) {
    return this.prisma.businessAudit.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async startAudit(businessId: string, user: AuthUser) {
    const b = await this.business(businessId);
    if (b.buildState === 'BUILDING') {
      throw new BadRequestException('A build is running for this business; wait for it to finish');
    }
    const running = await this.prisma.businessAudit.count({
      where: { businessId, status: 'RUNNING' },
    });
    if (running) throw new BadRequestException('An audit is already running');
    const filled = await this.prisma.businessSection.count({
      where: { businessId, content: { not: '' } },
    });
    if (!filled) {
      throw new BadRequestException('The profile is empty; write or build some sections first');
    }
    const audit = await this.prisma.businessAudit.create({
      data: { businessId, createdById: user.id },
    });
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_AUDIT',
      targetType: 'Business',
      targetId: businessId,
      input: { auditId: audit.id },
      userId: user.id,
    });
    await this.prisma.businessAudit.update({ where: { id: audit.id }, data: { jobId: job.id } });
    return { id: audit.id, jobId: job.id };
  }

  private async issueOf(auditId: string, index: number) {
    const audit = await this.prisma.businessAudit.findUnique({ where: { id: auditId } });
    if (!audit) throw new NotFoundException('Audit not found');
    const issues = auditIssues(audit);
    const issue = issues[index];
    if (!issue) throw new NotFoundException('Issue not found');
    return { audit, issues, issue };
  }

  /**
   * "Fix with AI": the issue becomes a one-off admin note (not a standing one) that
   * BUSINESS_REVISE applies — as suggestions by default, so the admin still decides.
   */
  async fixIssue(auditId: string, index: number, input: FixAuditIssueInput, user: AuthUser) {
    const { audit, issues, issue } = await this.issueOf(auditId, index);
    if (issue.status !== 'OPEN') throw new BadRequestException('This issue is not open');
    const b = await this.business(audit.businessId);
    const words = AUDIT_NOTE_WORDS[b.language] ?? AUDIT_NOTE_WORDS.en!;
    const where = issue.target === 'GENERAL' ? '' : ` (${words.section} ${issue.target})`;
    const note = await this.notes.create(
      audit.businessId,
      {
        text: [`${words.issue}${where}: ${issue.title}`, issue.detail, `${words.fix}: ${issue.fix}`]
          .filter(Boolean)
          .join('\n')
          .slice(0, 6000),
        apply: input.apply ?? 'SUGGEST',
        scope: 'NONE',
        standing: false,
      },
      user,
    );
    issues[index] = { ...issue, status: 'FIXING', noteId: note.id };
    await this.prisma.businessAudit.update({
      where: { id: auditId },
      data: { issues: asJson(issues) },
    });
    this.log(user, 'business.audit_fix', audit.businessId, { auditId, index, noteId: note.id });
    return note;
  }

  async dismissIssue(auditId: string, index: number, user: AuthUser) {
    const { audit, issues, issue } = await this.issueOf(auditId, index);
    issues[index] = { ...issue, status: issue.status === 'DISMISSED' ? 'OPEN' : 'DISMISSED' };
    const updated = await this.prisma.businessAudit.update({
      where: { id: auditId },
      data: { issues: asJson(issues) },
    });
    this.log(user, 'business.audit_dismiss', audit.businessId, { auditId, index });
    return updated;
  }
}

function dedupe(list: string[]) {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}
