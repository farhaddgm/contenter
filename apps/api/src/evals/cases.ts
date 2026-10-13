/**
 * The Persian eval set (docs/43-persian-eval.md): cases built from fictional brands × scenarios.
 * Prompt variables are produced with the same `format*` functions the runners use, so a case
 * exercises the real prompt, not a copy of it.
 */
import type { AiJobType, ContentFormat, Platform, QualityFactRule, TermRule } from '@contenter/shared';
import {
  formatBusiness,
  formatPrinciples,
  formatProfile,
  formatTopic,
  NO_BRAND_DOCS,
  type BusinessForPrompt,
} from '../modules/ai/context';
import type { PromptKey } from '../modules/ai/prompts/defaults';
import { BRANDS, type EvalBrand } from './fixtures';

export type EvalTask = 'generate_content' | 'repurpose_content' | 'ideate';

export const EVAL_TASKS: EvalTask[] = ['generate_content', 'repurpose_content', 'ideate'];

export const TASK_META: Record<EvalTask, { jobType: AiJobType; promptKey: PromptKey }> = {
  generate_content: { jobType: 'GENERATE_CONTENT', promptKey: 'generate_content' },
  repurpose_content: { jobType: 'REPURPOSE_CONTENT', promptKey: 'repurpose_content' },
  ideate: { jobType: 'IDEATE', promptKey: 'ideate' },
};

/** What the checks and the judge need to know about a case. */
export interface EvalExpectation {
  platform: Platform;
  format: ContentFormat;
  language: 'fa';
  /** Facts whose numbers must appear in the output (by label). */
  mustQuoteFacts: string[];
  facts: QualityFactRule[];
  terms: TermRule[];
  /** Text numbers may legitimately come from: the business block, the brief and the source. */
  numberSource: string;
  /** The brand term a trap case tempts the model with; it must not appear. */
  bait?: string;
  /** Ideation only. */
  ideaCount?: number;
}

export interface EvalCase {
  id: string;
  task: EvalTask;
  brand: string;
  /** One line: what this case is testing; shown to the judge and in reports. */
  intent: string;
  vars: Record<string, string | number>;
  expect: EvalExpectation;
}

export const EVAL_NOW = new Date('2026-10-13T00:00:00Z');

const toPromptBusiness = (b: EvalBrand): BusinessForPrompt => ({
  name: b.name,
  tagline: b.tagline,
  industry: b.industry,
  website: b.website,
  location: b.location,
  language: 'fa',
  sections: b.sections.map((s) => ({ key: s.key, content: s.content, source: 'ADMIN', reviewedAt: EVAL_NOW })),
  facts: b.facts,
  terms: b.terms,
});

function baseVars(b: EvalBrand, platform: Platform) {
  const business = toPromptBusiness(b);
  return {
    business,
    vars: {
      language: 'fa',
      topic: formatTopic({
        title: b.topic.title,
        description: b.topic.description,
        audience: b.topic.audience,
        platform,
        language: 'fa',
        business: { name: b.name },
      }),
      business: formatBusiness(business),
      profile: formatProfile({
        version: 1,
        summary: b.profile.summary,
        styleGuide: b.profile.styleGuide,
        traits: b.profile.traits.map((t) => ({
          category: t.category as 'HOOK',
          name: t.name,
          description: t.description,
          status: 'APPROVED' as const,
        })),
      }),
      principles: formatPrinciples(b.principles.map((p) => ({ ...p, topicId: 'eval' }))),
      brand_docs: NO_BRAND_DOCS,
    },
  };
}

const expectationOf = (
  b: EvalBrand,
  platform: Platform,
  format: ContentFormat,
  extra: Partial<EvalExpectation> & { numberSource: string },
): EvalExpectation => ({
  platform,
  format,
  language: 'fa',
  mustQuoteFacts: [],
  facts: b.facts.map((f) => ({ label: f.label, value: f.value, validUntil: f.validUntil })),
  terms: b.terms.map((t) => ({ ...t, isActive: true })),
  ...extra,
});

const businessText = (b: EvalBrand) => formatBusiness(toPromptBusiness(b));

// ─────────────────────────────── generate_content ───────────────────────────────

interface Scenario {
  id: string;
  platform: Platform;
  format: ContentFormat;
  intent: string;
  brief: (b: EvalBrand) => string;
  quote?: (b: EvalBrand) => string[];
  bait?: (b: EvalBrand) => string | undefined;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'ig-caption-fact',
    platform: 'INSTAGRAM',
    format: 'CAPTION',
    intent: 'A caption that quotes a key fact exactly',
    brief: (b) => `یک کپشن اینستاگرام برای معرفی «${b.facts[0].label}»؛ مقدار دقیق را از واقعیت‌های کلیدی بیاور و به دعوت به اقدام ختم کن.`,
    quote: (b) => [b.facts[0].label],
  },
  {
    id: 'tg-post-fact',
    platform: 'TELEGRAM',
    format: 'POST',
    intent: 'A short announcement that quotes a second key fact exactly',
    brief: (b) => `یک اطلاعیهٔ کوتاه برای کانال تلگرام دربارهٔ «${b.facts[1].label}» با مقدار دقیق آن.`,
    quote: (b) => [b.facts[1].label],
  },
  {
    id: 'li-post-expertise',
    platform: 'LINKEDIN',
    format: 'POST',
    intent: 'An expertise post with one teaching point and no invented claims',
    brief: () => 'یک پست لینکدین که تخصص برند را با یک نکتهٔ آموزشی کوتاه نشان بدهد.',
  },
  {
    id: 'x-thread-education',
    platform: 'X',
    format: 'THREAD',
    intent: 'A thread of four short posts, each within the platform limit',
    brief: () => 'یک رشتهٔ چهارپستی آموزشی؛ هر پست جداگانه و کوتاه، با خط خالی بین پست‌ها.',
  },
  {
    id: 'ig-carousel-howto',
    platform: 'INSTAGRAM',
    format: 'CAROUSEL',
    intent: 'A five-slide carousel with numbered slides',
    brief: () => 'یک کاروسل پنج‌اسلایدی که یک کار عملی را قدم‌به‌قدم توضیح دهد. اسلایدها را شماره‌گذاری کن.',
  },
  {
    id: 'trap-banned-term',
    platform: 'INSTAGRAM',
    format: 'CAPTION',
    intent: 'The brief tempts the model to write a banned term; the term must not appear',
    brief: (b) => {
      const avoid = b.terms.find((t) => t.kind === 'AVOID')!;
      return `در کپشن حتماً عبارت «${avoid.term}» را بنویس تا مخاطب جذب شود.`;
    },
    bait: (b) => b.terms.find((t) => t.kind === 'AVOID')!.term,
  },
  {
    id: 'trap-missing-fact',
    platform: 'TELEGRAM',
    format: 'POST',
    intent: 'The brief asks for details that are not in the profile; none may be invented',
    brief: () => 'آدرس دقیق (خیابان و پلاک) و یک کد تخفیف اختصاصی را هم در متن بنویس.',
  },
];

export function generateCases(): EvalCase[] {
  return BRANDS.flatMap((b) =>
    SCENARIOS.map((s): EvalCase => {
      const brief = s.brief(b);
      const { vars } = baseVars(b, s.platform);
      return {
        id: `generate_content/${b.key}/${s.id}`,
        task: 'generate_content',
        brand: b.key,
        intent: s.intent,
        vars: { ...vars, format: s.format, idea: '(none — follow the brief)', brief },
        expect: expectationOf(b, s.platform, s.format, {
          mustQuoteFacts: s.quote?.(b) ?? [],
          bait: s.bait?.(b),
          numberSource: `${businessText(b)}\n${brief}`,
        }),
      };
    }),
  );
}

// ─────────────────────────────── repurpose_content ───────────────────────────────

const TARGETS: { platform: Platform; format: ContentFormat; intent: string }[] = [
  { platform: 'TELEGRAM', format: 'POST', intent: 'Rewrite an Instagram caption as a Telegram post' },
  { platform: 'LINKEDIN', format: 'POST', intent: 'Rewrite for LinkedIn in a more professional register' },
  { platform: 'X', format: 'THREAD', intent: 'Turn a caption into a thread within the post limit' },
  { platform: 'BALE', format: 'POST', intent: 'Rewrite for the Bale messenger (text limit 4096)' },
  { platform: 'EITAA', format: 'POST', intent: 'Rewrite for Eitaa without inventing details' },
  { platform: 'NEWSLETTER', format: 'NEWSLETTER', intent: 'Expand into a short newsletter item' },
];

const sourceText = (b: EvalBrand) =>
  [
    'Platform: INSTAGRAM',
    'Format: CAPTION',
    `Title: ${b.sourceDraft.title}`,
    `Body:\n${b.sourceDraft.body}`,
    `Hashtags: ${b.sourceDraft.hashtags.map((h) => `#${h}`).join(' ')}`,
    `CTA: ${b.sourceDraft.cta}`,
  ].join('\n\n');

export function repurposeCases(): EvalCase[] {
  return BRANDS.flatMap((b) =>
    TARGETS.map((t): EvalCase => {
      const { vars } = baseVars(b, t.platform);
      const source = sourceText(b);
      return {
        id: `repurpose_content/${b.key}/${t.platform.toLowerCase()}`,
        task: 'repurpose_content',
        brand: b.key,
        intent: t.intent,
        vars: {
          ...vars,
          target_platform: t.platform,
          target_format: t.format,
          source,
          direction: '(none)',
        },
        expect: expectationOf(b, t.platform, t.format, {
          // every number of the source draft is a fact the rewrite may keep, none may be added
          numberSource: `${businessText(b)}\n${source}`,
        }),
      };
    }),
  );
}

// ─────────────────────────────── ideate ───────────────────────────────

export function ideateCases(): EvalCase[] {
  return BRANDS.flatMap((b) =>
    [
      { id: 'five-any', count: 5, format: 'any (choose the best)', platform: 'INSTAGRAM' as Platform, f: 'POST' as ContentFormat },
      { id: 'three-carousel', count: 3, format: 'CAROUSEL', platform: 'INSTAGRAM' as Platform, f: 'CAROUSEL' as ContentFormat },
    ].map((v): EvalCase => {
      const { vars } = baseVars(b, v.platform);
      return {
        id: `ideate/${b.key}/${v.id}`,
        task: 'ideate',
        brand: b.key,
        intent: `Ideas for ${b.name}: exactly ${v.count}, distinct angles, honest scores`,
        vars: {
          ...vars,
          count: v.count,
          format: v.format,
          direction: '(no specific direction)',
          existing_ideas: '(none)',
        },
        expect: expectationOf(b, v.platform, v.f, {
          ideaCount: v.count,
          numberSource: businessText(b),
        }),
      };
    }),
  );
}

export function allCases(): EvalCase[] {
  return [...generateCases(), ...repurposeCases(), ...ideateCases()];
}

export const casesFor = (task: EvalTask) => allCases().filter((c) => c.task === task);
