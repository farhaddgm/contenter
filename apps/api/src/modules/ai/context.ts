/**
 * Deterministic serializers that turn DB records into prompt context blocks.
 * Pure functions — easy to unit test and to keep prompt prefixes stable.
 */
import type {
  ContentProfile,
  Idea,
  Principle,
  ProfileTrait,
  SampleContent,
  Topic,
} from '@prisma/client';
import type { FetchedMedia, SampleAnalysisResult } from '@contenter/shared';

const MAX_SAMPLE_TEXT = 12_000;

export function formatTopic(
  t: Pick<Topic, 'title' | 'description' | 'audience' | 'platform' | 'language'>,
): string {
  return [
    `Title: ${t.title}`,
    `Platform: ${t.platform}`,
    `Language: ${t.language}`,
    t.audience ? `Audience: ${t.audience}` : null,
    `Description:\n${t.description}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const KIND_LABEL: Record<Principle['kind'], string> = {
  MUST: 'MUST',
  AVOID: 'AVOID',
  PREFER: 'PREFER',
};

export function formatPrinciples(list: Pick<Principle, 'kind' | 'text' | 'topicId'>[]): string {
  if (!list.length) return '(none)';
  return list
    .map((p) => `- [${KIND_LABEL[p.kind]}${p.topicId ? '' : ' · global'}] ${p.text}`)
    .join('\n');
}

export function formatProfile(
  p:
    | (Pick<ContentProfile, 'version' | 'summary' | 'styleGuide'> & {
        traits: Pick<ProfileTrait, 'category' | 'name' | 'description' | 'status'>[];
      })
    | null,
  { approvedOnly = true } = {},
): string {
  if (!p) return '(no approved content profile yet — rely on the topic and principles)';
  const traits = p.traits.filter((t) => !approvedOnly || t.status === 'APPROVED');
  return [
    `Version: ${p.version}`,
    `Summary: ${p.summary}`,
    `Traits:\n${traits.map((t) => `- (${t.category}) ${t.name}: ${t.description}`).join('\n') || '(none)'}`,
    `Style guide:\n${p.styleGuide}`,
  ].join('\n\n');
}

export function formatSample(
  s: Pick<SampleContent, 'url' | 'platform' | 'mediaType' | 'manualText' | 'adminNote'> & {
    fetched: unknown;
  },
): string {
  const f = (s.fetched ?? null) as FetchedMedia | null;
  const text = f?.text ? f.text.slice(0, MAX_SAMPLE_TEXT) : '';
  return [
    `URL: ${s.url}`,
    `Platform: ${s.platform}`,
    `Media type: ${s.mediaType}`,
    f?.siteName ? `Site: ${f.siteName}` : null,
    f?.author ? `Author: ${f.author}` : null,
    f?.title ? `Title: ${f.title}` : null,
    f?.description ? `Description: ${f.description}` : null,
    s.adminNote ? `Admin note (why this sample matters): ${s.adminNote}` : null,
    s.manualText ? `Admin-provided text / caption / transcript:\n${s.manualText}` : null,
    text ? `Extracted page text:\n${text}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAnalyses(items: { url: string; result: SampleAnalysisResult }[]): string {
  return items
    .map((a, i) =>
      [
        `### Sample ${i + 1} (${a.url})`,
        `Summary: ${a.result.summary}`,
        `Tone: ${a.result.tone}`,
        `Voice: ${a.result.voice}`,
        `Structure: ${a.result.structure}`,
        `Hook: ${a.result.hook}`,
        `Length: ${a.result.length}`,
        `Formatting: ${a.result.formatting}`,
        `CTA: ${a.result.cta}`,
        `Visual: ${a.result.visualStyle}`,
        `Language: ${a.result.languageNotes}`,
        `Traits:\n${a.result.traits.map((t) => `- (${t.category}) ${t.name}: ${t.description} — evidence: ${t.evidence}`).join('\n')}`,
      ].join('\n'),
    )
    .join('\n\n');
}

export function formatIdea(
  i: Pick<Idea, 'title' | 'angle' | 'hook' | 'format' | 'outline' | 'rationale'> | null,
): string {
  if (!i) return '(none — follow the brief)';
  return [
    `Title: ${i.title}`,
    `Angle: ${i.angle}`,
    `Hook: ${i.hook}`,
    `Format: ${i.format}`,
    `Outline:\n${i.outline.map((o, n) => `${n + 1}. ${o}`).join('\n')}`,
    `Rationale: ${i.rationale}`,
  ].join('\n');
}

export const clamp = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
