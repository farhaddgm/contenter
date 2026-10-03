/**
 * Request DTO schemas — used by the API ZodValidationPipe and by web forms.
 */
import { z } from 'zod';
import {
  AiEffort,
  AiJobStatus,
  AiJobType,
  BrandDocKind,
  ContentFormat,
  ContentStatus,
  IdeaStatus,
  LoginMethod,
  Platform,
  PrincipleKind,
  Role,
  TopicStatus,
  TraitCategory,
  TraitStatus,
} from './enums';
import { AiProviderName, MODEL_REF_PATTERN } from './ai-providers';

// ---------- common ----------
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ---------- auth ----------
export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

// ---------- Google sign-in (owner-managed allowlist) ----------
/**
 * Canonical form of a Gmail address for comparison: lower-case, dots and `+tag` removed from
 * the local part, googlemail.com → gmail.com (Gmail treats all of these as one mailbox).
 */
export function normalizeGmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 0) return lower;
  const domain = lower.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return lower;
  const local = lower.slice(0, at).split('+')[0]!.replaceAll('.', '');
  return `${local}@gmail.com`;
}

export const isGmail = (email: string) => /@(gmail|googlemail)\.com$/i.test(email.trim());

export const GmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .refine(isGmail, { message: 'Only @gmail.com addresses are allowed' });

/** Login methods the owner can grant; PASSWORD-only users are managed in the Users page. */
export const GoogleLoginMethod = ['GOOGLE', 'BOTH'] as const satisfies readonly LoginMethod[];
export type GoogleLoginMethod = (typeof GoogleLoginMethod)[number];

export const CreateGoogleAccessSchema = z
  .object({
    email: GmailSchema,
    name: z.string().trim().min(2).max(100),
    role: z.enum(Role),
    loginMethod: z.enum(GoogleLoginMethod),
    /** Required for BOTH when the account has no password yet (checked server-side). */
    password: z.string().min(8).max(128).optional(),
  })
  .refine((v) => v.loginMethod === 'BOTH' || !v.password, {
    path: ['password'],
    message: 'Google-only accounts have no password',
  });
export type CreateGoogleAccessInput = z.infer<typeof CreateGoogleAccessSchema>;

export const UpdateGoogleAccessSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(Role).optional(),
  isActive: z.boolean().optional(),
  loginMethod: z.enum(GoogleLoginMethod).optional(),
  password: z.string().min(8).max(128).optional(),
});
export type UpdateGoogleAccessInput = z.infer<typeof UpdateGoogleAccessSchema>;

// ---------- users ----------
/** Gmail sign-in (GOOGLE/BOTH) needs a Gmail address; only the owner may grant it (server-side). */
export const CreateUserSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(2).max(100),
    /** Required unless loginMethod is GOOGLE (Google-only accounts have no password). */
    password: z.string().min(8).max(128).optional(),
    role: z.enum(Role),
    /** Defaults to PASSWORD. */
    loginMethod: z.enum(LoginMethod).optional(),
  })
  .superRefine((v, ctx) => {
    const method = v.loginMethod ?? 'PASSWORD';
    if (method === 'GOOGLE' && v.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Google-only accounts have no password',
      });
    }
    if (method !== 'GOOGLE' && !v.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'A password is required for password sign-in',
      });
    }
    if (method !== 'PASSWORD' && !isGmail(v.email)) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Only @gmail.com addresses can sign in with Google',
      });
    }
  });
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(Role).optional(),
  isActive: z.boolean().optional(),
  /** Changing to/from Gmail sign-in is owner-only; BOTH/PASSWORD need a password (new or existing). */
  loginMethod: z.enum(LoginMethod).optional(),
  password: z.string().min(8).max(128).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * PATCH body from a create schema. Unlike `.partial()`, fields lose their defaults: in Zod 4 a
 * default still fills an omitted field, so `{ status: 'ARCHIVED' }` would reset every defaulted
 * field (tagline, language …). Here an omitted field stays undefined and Prisma leaves it as is.
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      (field instanceof z.ZodDefault
        ? (field.removeDefault() as z.ZodType)
        : (field as z.ZodType)
      ).optional(),
    ]),
  );
  return z.object(shape) as unknown as ReturnType<z.ZodObject<T>['partial']>;
}

// ---------- topics ----------
export const CreateTopicSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(10_000),
  audience: z.string().trim().max(1000).optional().default(''),
  platform: z.enum(Platform).default('INSTAGRAM'),
  language: z.string().trim().min(2).max(10).default('fa'),
  /** Business this project produces content for (null = none). */
  businessId: z.string().trim().min(1).nullish(),
});
export type CreateTopicInput = z.input<typeof CreateTopicSchema>;

export const UpdateTopicSchema = patchOf(CreateTopicSchema).extend({
  status: z.enum(TopicStatus).optional(),
});
export type UpdateTopicInput = z.input<typeof UpdateTopicSchema>;

export const TopicListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(TopicStatus).optional(),
  businessId: z.string().optional(),
});

// ---------- principles ----------
export const CreatePrincipleSchema = z.object({
  kind: z.enum(PrincipleKind),
  text: z.string().trim().min(3).max(2000),
  isActive: z.boolean().default(true),
  order: z.number().int().default(0),
});
export type CreatePrincipleInput = z.input<typeof CreatePrincipleSchema>;

export const UpdatePrincipleSchema = patchOf(CreatePrincipleSchema);
export type UpdatePrincipleInput = z.input<typeof UpdatePrincipleSchema>;

// ---------- samples ----------
export const CreateSampleSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  manualText: z.string().trim().max(50_000).optional().default(''),
  adminNote: z.string().trim().max(2000).optional().default(''),
  autoAnalyze: z.boolean().default(true),
});
export type CreateSampleInput = z.input<typeof CreateSampleSchema>;

export const UpdateSampleSchema = z.object({
  manualText: z.string().trim().max(50_000).optional(),
  adminNote: z.string().trim().max(2000).optional(),
});
export type UpdateSampleInput = z.infer<typeof UpdateSampleSchema>;

// ---------- profiles ----------
export const BuildProfileSchema = z.object({
  sampleIds: z.array(z.string()).optional(),
});
export type BuildProfileInput = z.infer<typeof BuildProfileSchema>;

export const UpdateProfileSchema = z.object({
  summary: z.string().trim().max(10_000).optional(),
  styleGuide: z.string().trim().max(50_000).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const CreateTraitSchema = z.object({
  category: z.enum(TraitCategory),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2).max(5000),
  evidence: z.string().trim().max(5000).optional().default(''),
});
export type CreateTraitInput = z.input<typeof CreateTraitSchema>;

/** Manual (non-AI) profile version. Traits are admin-authored and start APPROVED. */
export const CreateProfileSchema = z.object({
  summary: z.string().trim().max(10_000).optional().default(''),
  styleGuide: z.string().trim().max(50_000).optional().default(''),
  traits: z.array(CreateTraitSchema).max(60).optional().default([]),
});
export type CreateProfileInput = z.input<typeof CreateProfileSchema>;

export const UpdateTraitSchema = z.object({
  category: z.enum(TraitCategory).optional(),
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().min(2).max(5000).optional(),
  evidence: z.string().trim().max(5000).optional(),
  status: z.enum(TraitStatus).optional(),
});
export type UpdateTraitInput = z.infer<typeof UpdateTraitSchema>;

// ---------- brand documents ----------
export const BRAND_DOC_MAX_CHARS = 100_000;
/** Total brand-document text sent to the model per AI job; later documents are truncated first. */
export const BRAND_DOCS_PROMPT_CHARS = 40_000;

export const CreateBrandDocSchema = z.object({
  kind: z.enum(BrandDocKind).default('BRAND_BOOK'),
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().min(20).max(BRAND_DOC_MAX_CHARS),
  fileName: z.string().trim().max(255).nullish(),
  isActive: z.boolean().default(true),
});
export type CreateBrandDocInput = z.input<typeof CreateBrandDocSchema>;

export const UpdateBrandDocSchema = z.object({
  kind: z.enum(BrandDocKind).optional(),
  title: z.string().trim().min(2).max(200).optional(),
  content: z.string().trim().min(20).max(BRAND_DOC_MAX_CHARS).optional(),
  fileName: z.string().trim().max(255).nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateBrandDocInput = z.input<typeof UpdateBrandDocSchema>;

// ---------- ideas ----------
export const IdeateSchema = z.object({
  count: z.number().int().min(1).max(20).default(5),
  direction: z.string().trim().max(2000).optional().default(''),
  format: z.enum(ContentFormat).optional(),
});
export type IdeateInput = z.input<typeof IdeateSchema>;

export const UpdateIdeaSchema = z.object({
  status: z.enum(IdeaStatus).optional(),
  title: z.string().trim().min(2).max(300).optional(),
  angle: z.string().trim().max(5000).optional(),
  hook: z.string().trim().max(2000).optional(),
});
export type UpdateIdeaInput = z.infer<typeof UpdateIdeaSchema>;

export const IdeaListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(IdeaStatus).optional(),
});

// ---------- contents ----------
export const GenerateContentSchema = z
  .object({
    ideaId: z.string().optional(),
    brief: z.string().trim().max(5000).optional().default(''),
    format: z.enum(ContentFormat).optional(),
  })
  .refine((v) => !!v.ideaId || (v.brief ?? '').length >= 10, {
    message: 'Either ideaId or a brief (min 10 chars) is required',
    path: ['brief'],
  });
export type GenerateContentInput = z.input<typeof GenerateContentSchema>;

export const ReviseContentSchema = z.object({
  feedback: z.string().trim().min(3).max(5000),
});
export type ReviseContentInput = z.infer<typeof ReviseContentSchema>;

export const UpdateContentSchema = z.object({
  status: z.enum(ContentStatus).optional(),
  title: z.string().trim().min(1).max(300).optional(),
});
export type UpdateContentInput = z.infer<typeof UpdateContentSchema>;

export const EditContentVersionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(100_000),
  hashtags: z.array(z.string()).default([]),
  cta: z.string().max(2000).default(''),
  notes: z.string().max(10_000).default(''),
});
export type EditContentVersionInput = z.input<typeof EditContentVersionSchema>;

export const ContentListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(ContentStatus).optional(),
  topicId: z.string().optional(),
});

// ---------- jobs ----------
export const JobListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(AiJobStatus).optional(),
  type: z.enum(AiJobType).optional(),
});

// ---------- prompts ----------
export const CreatePromptVersionSchema = z.object({
  system: z.string().min(10).max(100_000),
  user: z.string().min(10).max(100_000),
  notes: z.string().max(2000).optional().default(''),
  activate: z.boolean().default(false),
});
export type CreatePromptVersionInput = z.input<typeof CreatePromptVersionSchema>;

// ---------- settings ----------
export const AiSettingsSchema = z.object({
  /** Task type (or `default`) → model reference `provider:model`. */
  models: z.record(z.string(), z.string().trim().min(3).max(120).regex(MODEL_REF_PATTERN)),
  effort: z.record(z.string(), z.enum(AiEffort)),
  maxSamplesPerProfile: z.number().int().min(1).max(50),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export interface AiProviderStatus {
  name: AiProviderName;
  /** API key present in the server environment. */
  configured: boolean;
  /** Text models the vendor's API currently lists (live, cached); absent when unavailable. */
  models?: string[];
}

export type AiSettingsResponse = AiSettings & {
  /** AI_PROVIDER=mock — every task returns placeholder output, no vendor is called. */
  mock: boolean;
  providers: AiProviderStatus[];
};
