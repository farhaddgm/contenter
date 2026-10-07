/**
 * API response shapes (what the web app receives).
 */
import type { TermIssue } from './business-profile';
import type {
  AiJobStatus,
  AiJobType,
  AnalysisStatus,
  BrandDocKind,
  CampaignStatus,
  ContentFormat,
  ContentStatus,
  FetchStatus,
  IdeaStatus,
  LoginMethod,
  MediaType,
  Platform,
  PrincipleKind,
  ProfileStatus,
  Role,
  AccessLevel,
  TagColor,
  TopicStatus,
  TraitCategory,
  TraitSource,
  TraitStatus,
} from './enums';
import type { SampleAnalysisResult, SelfCheck } from './ai';

export type ISODate = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  errors?: { path: string; message: string }[];
  /** Present on 5xx responses: id of the recorded AppError (Smart error tracker). */
  errorId?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  loginMethod: LoginMethod;
  hasPassword: boolean;
  /** The application owner (OWNER_EMAIL) — the only one who manages Google access. */
  isOwner: boolean;
  lastLoginAt: ISODate | null;
  createdAt: ISODate;
}

export interface AuthProviders {
  /** "Sign in with Google" is configured on the server. */
  google: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Topic {
  id: string;
  title: string;
  description: string;
  audience: string;
  platform: Platform;
  language: string;
  status: TopicStatus;
  activeProfileId: string | null;
  businessId: string | null;
  business?: { id: string; name: string } | null;
  /** Set when the admin skipped the sample-contents step (content then rests on documents). */
  samplesSkippedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  _count?: { samples: number; ideas: number; contents: number; profiles: number };
  /** The current user's access to this project (admins: EDIT). */
  access?: AccessLevel;
}

/** One topic or business in the owner's "access of this user" dialog (docs/17). */
export interface UserAccessRow {
  id: string;
  name: string;
  status: string;
  /** The user created it (EDIT unless a grant says otherwise). */
  isCreator: boolean;
  /** Explicit grant, if any. */
  granted: AccessLevel | null;
  /** What the user can actually do (null = no access). */
  effective: AccessLevel | null;
}

export interface UserAccess {
  topics: UserAccessRow[];
  businesses: UserAccessRow[];
}

export interface Principle {
  id: string;
  topicId: string | null;
  kind: PrincipleKind;
  text: string;
  isActive: boolean;
  order: number;
  createdAt: ISODate;
}

export interface FetchedMedia {
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  text: string | null;
  images: string[];
  publishedAt: string | null;
  embedHtml: string | null;
  finalUrl: string | null;
}

export interface SampleContent {
  id: string;
  topicId: string;
  url: string;
  platform: Platform;
  mediaType: MediaType;
  manualText: string;
  adminNote: string;
  fetchStatus: FetchStatus;
  fetchError: string | null;
  fetched: FetchedMedia | null;
  analysisStatus: AnalysisStatus;
  analysis: SampleAnalysis | null;
  createdAt: ISODate;
}

export interface SampleAnalysis {
  id: string;
  sampleId: string;
  summary: string;
  result: SampleAnalysisResult;
  jobId: string | null;
  createdAt: ISODate;
}

export interface ProfileTrait {
  id: string;
  profileId: string;
  category: TraitCategory;
  name: string;
  description: string;
  evidence: string;
  confidence: number;
  status: TraitStatus;
  source: TraitSource;
  createdAt: ISODate;
}

export interface ContentProfile {
  id: string;
  topicId: string;
  version: number;
  status: ProfileStatus;
  summary: string;
  styleGuide: string;
  sampleIds: string[];
  brandDocIds: string[];
  /** Set when the version was copied from another one. */
  basedOnVersion: number | null;
  /** Null for manual and copied versions. */
  jobId: string | null;
  approvedAt: ISODate | null;
  createdAt: ISODate;
  traits?: ProfileTrait[];
  isActive?: boolean;
}

export interface BrandDocument {
  id: string;
  topicId: string;
  kind: BrandDocKind;
  title: string;
  fileName: string | null;
  isActive: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Full text; list responses omit it and send `chars` instead. */
  content?: string;
  chars: number;
}

/** What the generative AI jobs of a topic will receive as context. */
export interface TopicAiContext {
  analyzedSamples: number;
  topicPrinciples: number;
  globalPrinciples: number;
  brandDocs: { id: string; title: string; kind: BrandDocKind; chars: number }[];
  activeProfile: { id: string; version: number; approvedTraits: number } | null;
  /** Linked business; its filled profile sections reach every AI job of the topic. */
  business: {
    id: string;
    name: string;
    filledSections: number;
    /** Readable, active reference documents; they reach the topic's AI jobs while it has no analyzed samples. */
    references: number;
  } | null;
  /** The admin skipped the sample-contents step. */
  samplesSkipped: boolean;
}

export interface Idea {
  id: string;
  topicId: string;
  requestId: string | null;
  title: string;
  angle: string;
  hook: string;
  format: ContentFormat;
  outline: string[];
  rationale: string;
  score: number;
  status: IdeaStatus;
  createdAt: ISODate;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  topicId: string;
  name: string;
  color: TagColor;
  createdAt: ISODate;
  /** Topic tag list only. */
  _count?: { contents: number; ideas: number };
}

export interface Campaign {
  id: string;
  topicId: string;
  name: string;
  description: string;
  status: CampaignStatus;
  startsAt: ISODate | null;
  endsAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Topic campaign list only. */
  _count?: { contents: number };
}

export interface IdeationRequest {
  id: string;
  topicId: string;
  count: number;
  direction: string;
  format: ContentFormat | null;
  jobId: string | null;
  createdAt: ISODate;
}

export interface ContentVersion {
  id: string;
  contentId: string;
  version: number;
  title: string;
  body: string;
  hashtags: string[];
  cta: string;
  notes: string;
  selfCheck: SelfCheck | null;
  feedback: string | null;
  source: 'AI' | 'ADMIN';
  jobId: string | null;
  createdAt: ISODate;
}

export interface Content {
  id: string;
  topicId: string;
  ideaId: string | null;
  profileId: string | null;
  campaignId: string | null;
  title: string;
  brief: string;
  format: ContentFormat;
  status: ContentStatus;
  currentVersionId: string | null;
  lastJobId: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  currentVersion?: ContentVersion | null;
  versions?: ContentVersion[];
  topic?: Pick<Topic, 'id' | 'title'>;
  idea?: Pick<Idea, 'id' | 'title'> | null;
  tags?: Tag[];
  campaign?: Pick<Campaign, 'id' | 'name' | 'status'> | null;
  /** Detail only: brand terminology violations of the current version (linked business). */
  termIssues?: TermIssue[];
}

export interface AiJob {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  targetType: string;
  targetId: string;
  topicId: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  attempts: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  promptKey: string | null;
  promptVersion: number | null;
  startedAt: ISODate | null;
  finishedAt: ISODate | null;
  createdAt: ISODate;
  createdBy?: Pick<User, 'id' | 'name'> | null;
}

export interface JobAccepted {
  jobId: string;
}

export interface PromptTemplate {
  id: string;
  key: string;
  version: number;
  system: string;
  user: string;
  notes: string;
  isActive: boolean;
  createdAt: ISODate;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: ISODate;
  user?: Pick<User, 'id' | 'name' | 'email'> | null;
}

export interface DashboardStats {
  counts: {
    topics: number;
    samples: number;
    profiles: number;
    ideas: number;
    contents: number;
    users: number;
  };
  contentsByStatus: Record<string, number>;
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    byType: {
      type: AiJobType;
      count: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
    }[];
    totalCostUsd: number;
  };
  daily: { date: string; jobs: number; costUsd: number; contents: number }[];
  recentJobs: AiJob[];
}
