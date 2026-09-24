/**
 * Output contracts for every AI task.
 *
 * These schemas are sent to the model as Structured Output formats, then
 * re-validated by the server before anything is persisted. Keep them within
 * the JSON Schema subset supported by structured outputs: every field is
 * required (use nullable instead of optional) and avoid numeric/length
 * constraints; clamp numeric ranges in code instead.
 */
import { z } from 'zod';
import { ContentFormat, TraitCategory } from './enums';

export const AiTraitSchema = z.object({
  category: z.enum(TraitCategory),
  name: z.string().describe('Short name of the characteristic'),
  description: z.string().describe('How the characteristic shows up and how to reproduce it'),
  evidence: z.string().describe('Concrete evidence from the sample(s)'),
});
export type AiTrait = z.infer<typeof AiTraitSchema>;

export const SampleAnalysisResultSchema = z.object({
  summary: z.string().describe('One-paragraph summary of what the sample is about'),
  tone: z.string(),
  voice: z.string().describe('Narrator persona / point of view'),
  audience: z.string(),
  structure: z.string().describe('How the content is organized, section by section'),
  hook: z.string().describe('How the first seconds/lines capture attention'),
  length: z.string().describe('Approximate length and pacing'),
  formatting: z.string().describe('Line breaks, emojis, lists, hashtags, headings...'),
  cta: z.string().describe('Call to action, or "none"'),
  visualStyle: z.string().describe('Visual style if images are available, otherwise "unknown"'),
  languageNotes: z.string().describe('Vocabulary, register, sentence length, idioms'),
  strengths: z.array(z.string()),
  traits: z.array(AiTraitSchema),
});
export type SampleAnalysisResult = z.infer<typeof SampleAnalysisResultSchema>;

export const ProfileBuildResultSchema = z.object({
  summary: z.string().describe('Summary of the shared style across samples'),
  styleGuide: z
    .string()
    .describe(
      'A practical style guide in Markdown that a writer can follow to reproduce the style',
    ),
  traits: z.array(
    AiTraitSchema.extend({
      confidence: z.number().describe('0..1 — how consistently the trait appears across samples'),
    }),
  ),
});
export type ProfileBuildResult = z.infer<typeof ProfileBuildResultSchema>;

export const AiIdeaSchema = z.object({
  title: z.string(),
  angle: z.string().describe('The unique perspective of this idea'),
  hook: z.string().describe('Opening line / first 3 seconds'),
  format: z.enum(ContentFormat),
  outline: z.array(z.string()),
  rationale: z.string().describe('Why this fits the topic, audience and profile'),
  score: z.number().describe('0..10 expected quality/fit'),
});
export type AiIdea = z.infer<typeof AiIdeaSchema>;

export const IdeationResultSchema = z.object({
  ideas: z.array(AiIdeaSchema),
});
export type IdeationResult = z.infer<typeof IdeationResultSchema>;

export const SelfCheckSchema = z.object({
  score: z.number().describe('0..10 overall fit to profile and principles'),
  principles: z.array(
    z.object({
      principle: z.string(),
      satisfied: z.boolean(),
      note: z.string(),
    }),
  ),
  suggestions: z.array(z.string()),
});
export type SelfCheck = z.infer<typeof SelfCheckSchema>;

export const ContentDraftResultSchema = z.object({
  title: z.string(),
  body: z.string().describe('Full content in Markdown'),
  hashtags: z.array(z.string()),
  cta: z.string(),
  notes: z.string().describe('Production notes: visuals, b-roll, cover text, etc.'),
  selfCheck: SelfCheckSchema,
});
export type ContentDraftResult = z.infer<typeof ContentDraftResultSchema>;
