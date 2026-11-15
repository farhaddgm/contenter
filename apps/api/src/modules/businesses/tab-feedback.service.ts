import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BUSINESS_NOTE_MAX_CHARS,
  type TabFeedbackInput,
  type TabFeedbackTab,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessNotesService } from './notes-assets.service';

const TITLE: Record<TabFeedbackTab, string> = {
  knowledge: 'واقعیت‌ها و واژگان',
  coverage: 'پوشش محتوایی',
  references: 'منابع مرجع',
  assets: 'محتواها و فایل‌ها',
  styles: 'سبک‌ها',
  competitors: 'رقبا',
};

const PER_ITEM_CHARS = 400;
const clip = (s: string, n = PER_ITEM_CHARS) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/**
 * "Feedback to profile" (docs/76): the data of a profile tab is gathered by code into a note and
 * handed to the ordinary note flow in SUGGEST mode, so the model's changes land as pending
 * suggestions in the matching profile sections (locks, history and review stay in one path).
 */
@Injectable()
export class TabFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: BusinessNotesService,
  ) {}

  async send(businessId: string, input: TabFeedbackInput, user: AuthUser) {
    const lines = await this.lines(businessId, input.tab);
    if (!lines.length) throw new NotFoundException('This tab has no data to send yet');
    const head =
      `بازخورد از تب «${TITLE[input.tab]}» به پروفایل. اطلاعات زیر در این تب ثبت شده است؛ ` +
      'فقط آنچه با پروفایل تفاوت یا کمبود دارد را به‌صورت پیشنهاد در بخش‌های مربوط بنویس و چیزی از خودت اضافه نکن:';
    let text = head;
    for (const line of lines) {
      if (text.length + line.length + 1 > BUSINESS_NOTE_MAX_CHARS) break;
      text += `\n${line}`;
    }
    return this.notes.create(
      businessId,
      { text, apply: 'SUGGEST', scope: 'NONE', standing: false },
      user,
    );
  }

  private async lines(businessId: string, tab: TabFeedbackTab): Promise<string[]> {
    const where = { businessId, isActive: true };
    switch (tab) {
      case 'knowledge': {
        const [facts, terms] = await Promise.all([
          this.prisma.businessFact.findMany({
            where: { ...where, verified: true },
            orderBy: { updatedAt: 'desc' },
            take: 60,
          }),
          this.prisma.businessTerm.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 60 }),
        ]);
        return [
          ...facts.map((f) => `- واقعیت (${f.category}): ${f.label} = ${clip(f.value)}`),
          ...terms.map(
            (x) =>
              `- واژه (${x.kind}): ${x.term}${x.alternatives.length ? ` (جایگزین‌ها: ${x.alternatives.join('، ')})` : ''}`,
          ),
        ];
      }
      case 'coverage': {
        const pillars = await this.prisma.contentPillar.findMany({
          where: { businessId },
          orderBy: { order: 'asc' },
          include: { _count: { select: { contents: true } } },
        });
        return pillars.map(
          (p) =>
            `- ستون محتوایی: ${p.name}${p.targetShare != null ? ` (سهم هدف ${p.targetShare}٪)` : ''}، ${p._count.contents} محتوا`,
        );
      }
      case 'references': {
        const refs = await this.prisma.businessReference.findMany({
          where: { ...where, status: 'READY', audience: { not: 'APPS' } },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        });
        return refs.map((r) => `- منبع (${r.kind}) ${r.title || r.url}: ${clip(r.content, 600)}`);
      }
      case 'assets': {
        const assets = await this.prisma.businessAsset.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: 30,
        });
        return assets.map(
          (a) =>
            `- ${a.kind} «${a.title || a.fileName || a.url}»: ${clip(a.description || a.text || JSON.stringify(a.analysis ?? ''), 500)}`,
        );
      }
      case 'styles': {
        const styles = await this.prisma.businessStyle.findMany({
          where: { businessId, reviewedAt: { not: null } },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        });
        return styles.map((s) => `- سبک «${s.name}»: ${clip(s.summary, 500)}`);
      }
      case 'competitors': {
        const rows = await this.prisma.businessCompetitor.findMany({
          where: { ...where, verified: true },
          orderBy: { sortOrder: 'asc' },
          take: 30,
        });
        return rows.map(
          (c) =>
            `- رقیب (${c.kind}) ${c.name}: ${clip(c.positioning)}${c.difference ? ` | تفاوت ما: ${clip(c.difference, 200)}` : ''}`,
        );
      }
    }
  }
}
