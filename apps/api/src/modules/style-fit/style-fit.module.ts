import { Global, Injectable, Module } from '@nestjs/common';
import {
  MIN_STYLE_SAMPLES,
  assessStyleFit,
  publishText,
  styleStats,
  targetsFromInstagram,
  targetsFromTexts,
  type InstagramStats,
  type StyleFitReport,
  type StyleTargets,
} from '@contenter/shared';
import { AccessService } from '../../common/access';
import type { AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessApi } from '../businesses/business-api';

const MAX_SAMPLES = 30;

export interface StyleFitSubject {
  topicId: string;
  businessId: string | null;
  body: string;
  hashtags: string[];
  cta: string;
}

export type StyleFitResult =
  StyleFitReport | { tooFew: true; basedOn: number; needed: number } | null;

const isTargets = (t: StyleTargets | { tooFew: true }): t is StyleTargets => !('tooFew' in t);

/**
 * StyleFit (docs/53-style-fit.md): where the current draft lies against the statistical range of
 * the topic's analyzed samples or, without enough of them, the business's Instagram averages.
 * Code only (`assessStyleFit`); no data means no card, never an invented number.
 */
@Injectable()
export class StyleFitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly businesses: BusinessApi,
  ) {}

  async forContent(user: AuthUser, c: StyleFitSubject): Promise<StyleFitResult> {
    const samples = await this.prisma.sampleContent.findMany({
      where: { topicId: c.topicId, analysisStatus: 'DONE' },
      orderBy: { createdAt: 'desc' },
      take: MAX_SAMPLES,
      select: { manualText: true, fetched: true },
    });
    const texts = samples
      .map((s) => {
        const fetched = (s.fetched ?? {}) as { text?: string | null };
        return [s.manualText, fetched.text ?? ''].filter((t) => t.trim()).join('\n');
      })
      .filter(Boolean);
    const fromSamples = targetsFromTexts(texts);
    let targets: StyleTargets | null = isTargets(fromSamples) ? fromSamples : null;

    // a business without enough samples may still have an Instagram account that was read
    if (!targets && c.businessId) {
      const ig = await this.instagram(user, c.businessId);
      if (ig) {
        const fromIg = targetsFromInstagram(ig);
        if (isTargets(fromIg)) targets = fromIg;
      }
    }
    if (!targets) {
      return texts.length
        ? {
            tooFew: true,
            basedOn: fromSamples && 'basedOn' in fromSamples ? fromSamples.basedOn : 0,
            needed: MIN_STYLE_SAMPLES,
          }
        : null;
    }
    // the same shape as a sample caption: body (with its call to action on the next line) and the
    // hashtags last; the title is a separate field of ours and is left out
    const text = publishText({
      body: [c.body.trim(), c.cta.trim()].filter(Boolean).join('\n'),
      hashtags: c.hashtags,
      cta: '',
    });
    return assessStyleFit(styleStats(text, c.cta), targets);
  }

  /** Its averages describe the business, so they need access to the business itself. */
  private async instagram(user: AuthUser, businessId: string): Promise<InstagramStats | null> {
    try {
      await this.access.assert(user, 'business', businessId, 'VIEW');
    } catch {
      return null;
    }
    return this.businesses.instagramStats(businessId);
  }
}

@Global()
@Module({ providers: [StyleFitService], exports: [StyleFitService] })
export class StyleFitModule {}
