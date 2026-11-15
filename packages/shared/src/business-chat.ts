/**
 * Profile conversation (docs/75): the admin talks to AI about a business; AI listens, asks
 * what is unclear and keeps a running list of what it understood and which sections it touches.
 * Nothing changes while they talk. At the end the admin asks for a digest, edits it and applies
 * it, which creates an ordinary BusinessNote (BUSINESS_REVISE) — locks, history and suggestions
 * work exactly as for a note.
 */
import { z } from 'zod';
import { BusinessSectionKey, ResearchScope } from './business';
import { BUSINESS_NOTE_MAX_CHARS, NoteApplyMode } from './business-assets';

export const BUSINESS_CHAT_MESSAGE_MAX_CHARS = 4000;
/** A conversation is meant to be short; past this the admin summarizes and starts again. */
export const BUSINESS_CHAT_MAX_MESSAGES = 60;
/** Messages given to the model as the transcript (newest kept). */
export const BUSINESS_CHAT_TRANSCRIPT_CHARS = 24_000;

export const ChatRole = ['USER', 'ASSISTANT'] as const;
export type ChatRole = (typeof ChatRole)[number];

export const ChatMessageStatus = ['PENDING', 'DONE', 'FAILED'] as const;
export type ChatMessageStatus = (typeof ChatMessageStatus)[number];

export const ChatState = ['OPEN', 'APPLIED'] as const;
export type ChatState = (typeof ChatState)[number];

export const DigestStatus = ['NONE', 'PENDING', 'DONE', 'FAILED'] as const;
export type DigestStatus = (typeof DigestStatus)[number];

/**
 * What a point of the conversation is:
 * FACT new information · CORRECTION replaces something in the profile · DECISION a choice the
 * admin made · PREFERENCE a way of writing/behaving · OPEN something still unsettled.
 */
export const ChatPointKind = ['FACT', 'CORRECTION', 'DECISION', 'PREFERENCE', 'OPEN'] as const;
export type ChatPointKind = (typeof ChatPointKind)[number];

export const ChatPointSchema = z.object({
  point: z.string().describe('One self-contained statement, in the admin\'s own meaning'),
  kind: z.enum(ChatPointKind),
  sections: z
    .array(z.enum(BusinessSectionKey))
    .describe('Profile sections this point affects, directly or indirectly'),
});
export type ChatPoint = z.infer<typeof ChatPointSchema>;

/** Output of one conversational turn. */
export const BusinessChatReplySchema = z.object({
  reply: z.string().describe('What the admin reads: short, natural, in the business language'),
  understood: z
    .array(ChatPointSchema)
    .describe('The FULL running list of points so far (carry earlier ones forward)'),
  questions: z.array(z.string()).describe('At most 2 questions that block a correct update'),
  conflicts: z
    .array(z.string())
    .describe('Places where what the admin said clashes with the profile, facts or terminology'),
});
export type BusinessChatReply = z.infer<typeof BusinessChatReplySchema>;

/** Output of the digest step: the text the revision will be given, plus the structured points. */
export const BusinessChatDigestSchema = z.object({
  summary: z.string().describe('2–4 sentences for the admin: what the conversation settled'),
  noteText: z
    .string()
    .describe('The instruction for the profile revision: complete, ordered by topic, no chit-chat'),
  points: z.array(ChatPointSchema),
  openQuestions: z.array(z.string()).describe('What stayed unsettled and was left out of noteText'),
});
export type BusinessChatDigest = z.infer<typeof BusinessChatDigestSchema>;

export const SendChatMessageSchema = z.object({
  text: z.string().trim().min(1).max(BUSINESS_CHAT_MESSAGE_MAX_CHARS),
});
export type SendChatMessageInput = z.infer<typeof SendChatMessageSchema>;

/** The admin reviews/edits the digest, then chooses how it is applied. */
export const ApplyChatSchema = z.object({
  noteText: z.string().trim().min(3).max(BUSINESS_NOTE_MAX_CHARS),
  apply: z.enum(NoteApplyMode).default('DIRECT'),
  scope: z.enum(ResearchScope).default('NONE'),
  referenceIds: z.array(z.string().min(1).max(50)).max(50).optional(),
  standing: z.boolean().default(true),
});
export type ApplyChatInput = z.input<typeof ApplyChatSchema>;

export interface BusinessChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  status: ChatMessageStatus;
  error: string | null;
  /** Assistant messages only. */
  understood: ChatPoint[];
  questions: string[];
  conflicts: string[];
  createdAt: string;
}

export interface BusinessChat {
  id: string;
  businessId: string;
  state: ChatState;
  messages: BusinessChatMessage[];
  digestStatus: DigestStatus;
  digestError: string | null;
  digest: BusinessChatDigest | null;
  /** Messages the digest covers; fewer than now = the conversation moved on. */
  digestUpTo: number;
  noteId: string | null;
  createdAt: string;
}

/** The latest running list of points, from the last finished assistant message. */
export function latestUnderstood(messages: BusinessChatMessage[]): ChatPoint[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'ASSISTANT' && m.status === 'DONE') return m.understood;
  }
  return [];
}

/** Sections the running list touches, in profile order, to show "what will change". */
export function touchedSections(points: ChatPoint[]): BusinessSectionKey[] {
  const set = new Set(points.filter((p) => p.kind !== 'OPEN').flatMap((p) => p.sections));
  return BusinessSectionKey.filter((k) => set.has(k));
}
