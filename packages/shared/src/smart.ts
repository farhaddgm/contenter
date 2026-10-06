/**
 * "Smart" (اسمارت): Walker step-by-step guide, error tracker, AI assistant chat,
 * the Walker issue log and opt-in detailed interaction logging.
 */
import { z } from 'zod';
import { PaginationQuerySchema } from './schemas';
import type { AiJobStatus } from './enums';

// ---------- enums ----------

/** Ordered steps of the Walker flow for one project (topic). */
export const WalkerStepKey = [
  'select_topic',
  'describe_topic',
  'principles',
  'add_samples',
  'analyze_samples',
  'build_profile',
  'approve_profile',
  'ideate',
  'generate_content',
  'review_content',
  'approve_content',
] as const;
export type WalkerStepKey = (typeof WalkerStepKey)[number];

export const ErrorSource = ['SERVER', 'CLIENT', 'AI_JOB'] as const;
export type ErrorSource = (typeof ErrorSource)[number];

export const ErrorStatus = ['NEW', 'SEEN', 'RESOLVED', 'IGNORED'] as const;
export type ErrorStatus = (typeof ErrorStatus)[number];

export const ErrorCategory = [
  'DATABASE',
  'VALIDATION',
  'AUTH',
  'NETWORK',
  'AI',
  'NOT_FOUND',
  'CLIENT_RUNTIME',
  'UNKNOWN',
] as const;
export type ErrorCategory = (typeof ErrorCategory)[number];

export const ConversationKind = ['WALKER', 'ERROR'] as const;
export type ConversationKind = (typeof ConversationKind)[number];

export const SmartMessageRole = ['USER', 'ASSISTANT'] as const;
export type SmartMessageRole = (typeof SmartMessageRole)[number];

export const SmartMessageStatus = ['PENDING', 'DONE', 'FAILED'] as const;
export type SmartMessageStatus = (typeof SmartMessageStatus)[number];

export const IssueStatus = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'] as const;
export type IssueStatus = (typeof IssueStatus)[number];

export const IssueSource = ['WALKER_CHAT', 'ERROR_CHAT'] as const;
export type IssueSource = (typeof IssueSource)[number];

export const InteractionType = [
  'api.request',
  'page.view',
  'ui.click',
  'ui.submit',
  'walker.step',
  'walker.navigate',
  'smart.toggle',
] as const;
export type InteractionType = (typeof InteractionType)[number];

// ---------- AI output ----------

export const SmartReplySchema = z.object({
  reply: z.string().describe('Answer to the admin in Markdown'),
});
export type SmartReply = z.infer<typeof SmartReplySchema>;

// ---------- requests ----------

export const SmartSettingsSchema = z.object({
  /** Opt-in: store every admin/user interaction (API calls, page views, clicks). */
  detailedLogging: z.boolean(),
  /** Days to keep interaction logs. */
  retentionDays: z.number().int().min(1).max(365),
});
export type SmartSettings = z.infer<typeof SmartSettingsSchema>;

export const ClientEventSchema = z.object({
  type: z.enum(InteractionType),
  route: z.string().max(500).optional(),
  target: z.string().max(300).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  at: z.string().datetime().optional(),
});
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ClientEventsBatchSchema = z.object({
  sessionId: z.string().max(100),
  events: z.array(ClientEventSchema).max(100),
});
export type ClientEventsBatch = z.infer<typeof ClientEventsBatchSchema>;

export const ReportClientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  detail: z.string().max(20_000).optional(),
  route: z.string().max(500).optional(),
  kind: z.enum(['runtime', 'promise', 'render', 'api']).default('runtime'),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type ReportClientErrorInput = z.input<typeof ReportClientErrorSchema>;

export const ErrorListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(ErrorStatus).optional(),
  source: z.enum(ErrorSource).optional(),
});

export const UpdateErrorSchema = z.object({ status: z.enum(ErrorStatus) });
export type UpdateErrorInput = z.infer<typeof UpdateErrorSchema>;

export const StartConversationSchema = z.object({
  kind: z.enum(ConversationKind),
  errorId: z.string().optional(),
  topicId: z.string().optional(),
  route: z.string().max(500).optional(),
});
export type StartConversationInput = z.infer<typeof StartConversationSchema>;

export const SendSmartMessageSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  /** Where the admin is right now — part of the AI context. */
  route: z.string().max(500).optional(),
  topicId: z.string().optional(),
  walkerStep: z.enum(WalkerStepKey).optional(),
});
export type SendSmartMessageInput = z.infer<typeof SendSmartMessageSchema>;

export const SaveIssueSchema = z.object({ messageId: z.string() });
export type SaveIssueInput = z.infer<typeof SaveIssueSchema>;

export const UpdateIssueSchema = z.object({
  status: z.enum(IssueStatus).optional(),
  title: z.string().trim().min(2).max(300).optional(),
  resolutionNote: z.string().max(10_000).optional(),
});
export type UpdateIssueInput = z.infer<typeof UpdateIssueSchema>;

export const IssueListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(IssueStatus).optional(),
});

export const InteractionListQuerySchema = PaginationQuerySchema.extend({
  type: z.string().max(50).optional(),
  userId: z.string().optional(),
});

// ---------- responses ----------

export interface SmartConfig {
  detailedLogging: boolean;
  retentionDays: number;
}

export interface WalkerStepProgress {
  key: WalkerStepKey;
  done: boolean;
  /** e.g. analyzed samples / total samples */
  current?: number;
  target?: number;
  /** A previous step must be done first. */
  blocked: boolean;
  /** The admin may skip this step (sample contents). */
  skippable?: boolean;
  /** Done because the admin skipped it, not because the work exists. */
  skipped?: boolean;
}

export interface WalkerProgress {
  topic: {
    id: string;
    title: string;
    activeProfileId: string | null;
    samplesSkipped: boolean;
  } | null;
  steps: WalkerStepProgress[];
  nextStep: WalkerStepKey | null;
  completed: boolean;
  refs: {
    latestContentId: string | null;
    reviewContentId: string | null;
    latestProfileId: string | null;
  };
}

export interface InteractionLog {
  id: string;
  userId: string | null;
  sessionId: string | null;
  source: 'CLIENT' | 'SERVER';
  type: string;
  route: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  target: string | null;
  meta: unknown;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

export interface ActivityItem {
  kind: 'audit' | 'interaction';
  id: string;
  label: string;
  detail: string | null;
  at: string;
}

export interface AppError {
  id: string;
  fingerprint: string;
  source: ErrorSource;
  category: ErrorCategory;
  message: string;
  hint: string | null;
  detail: string | null;
  statusCode: number | null;
  method: string | null;
  path: string | null;
  route: string | null;
  jobId: string | null;
  context: unknown;
  count: number;
  status: ErrorStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  user?: { id: string; name: string } | null;
}

export interface SmartMessage {
  id: string;
  conversationId: string;
  role: SmartMessageRole;
  content: string;
  status: SmartMessageStatus;
  jobId: string | null;
  jobStatus?: AiJobStatus | null;
  issueId: string | null;
  createdAt: string;
}

export interface SmartConversation {
  id: string;
  kind: ConversationKind;
  title: string;
  errorId: string | null;
  topicId: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: SmartMessage[];
}

export interface WalkerIssue {
  id: string;
  title: string;
  content: string;
  source: IssueSource;
  status: IssueStatus;
  conversationId: string | null;
  messageId: string | null;
  errorId: string | null;
  topicId: string | null;
  route: string | null;
  context: unknown;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string } | null;
}
