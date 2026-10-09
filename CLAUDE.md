# Contenter — notes for Claude

Monorepo (npm workspaces): `apps/api` (NestJS + Prisma + BullMQ), `apps/web` (React/Vite, bulletproof-react layout), `packages/shared` (Zod schemas/types, built with tsup — run `npm run build -w @contenter/shared` after changing it).

## Core rule
AI decides, code executes. LLM calls only happen inside AI runners (`apps/api/src/modules/ai/runners`) executed by the queue worker; they return schema-validated JSON and the runner persists it. Never call the AI provider from a controller/request path — use `AiJobsService.enqueue()`.

## Commands
- `npm run dev` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run build`
- DB: `npm run db:migrate`, `npm run db:seed` (apps/api/.env; `AI_PROVIDER=mock` needs no key; `QUEUE_DRIVER=inline` needs no Redis)

## Conventions
- Request/response contracts live in `packages/shared`; API validates with `ZodValidationPipe`, web forms with `zodResolver` on the same schema.
- Enums exist in both `schema.prisma` and `packages/shared/src/enums.ts` — keep in sync.
- Audit important mutations with `AuditService.log()`.
- Web: features must not import from `app/`; translation keys are typed from `i18n/fa.ts` (en must match); use logical CSS (`ps-`, `start-`) for RTL.
- Dialogs with local state mount only while open (no reset-in-effect; react-hooks v7 rules).
- Docs are in Persian under `docs/`; update them with behavior changes.

## Businesses (docs/12-businesses.md, docs/14-business-references.md)
- AI builds/suggestions take a `ResearchScope`; `consult()` in `business.runners.ts` assembles references + web notes into the `research` prompt variable.
- Admin notes → `BUSINESS_REVISE`; brand assets → `BUSINESS_ASSET_ANALYZE` (docs/15).
- Profile quality (docs/16): section behavior comes from `BUSINESS_SECTION_META` (append new keys to the end of `BusinessSectionKey`); AI-written sections stay unreviewed until the admin confirms (`writeSection` `reviewed`); key facts / terminology ride in the `business` variable as `[FACTS]` / `[TERMINOLOGY]`; terminology is checked by code (`checkTerms`), never by the model; `BUSINESS_AUDIT` issues are fixed through one-off notes (suggestions). Asset analyses ride inside the `business` prompt variable (`formatBusinessAssets`), so every topic job gets them. Uploads live in `FileStorageService` (`UPLOAD_DIR`, signed URLs); the worker reads the same volume.
- Never treat a shared host (Drive, social networks — `isSharedHost`) as "the business's site", and never store a sign-in page as content (`isLoginWall`).
- Instagram account + website sources (docs/28): `INSTAGRAM` / `WEBSITE` references are read by code in the request path (`apps/api/src/modules/businesses/social`), never by the model. **Never fetch instagram.com pages** (its robots.txt forbids automated collection and a logged-out page has no bio/captions): an account is read through the official Graph API Business Discovery (`InstagramService`, off unless `INSTAGRAM_GRAPH_TOKEN` + `INSTAGRAM_GRAPH_USER_ID` are set) or comes from data the admin typed/uploaded (`provider: MANUAL`, no refresh). Statistics are computed in `instagram-analysis.ts` and stored in `BusinessReference.analysis` (`ReferenceAnalysis`, shared `social.ts`); the model only interprets them, with per-kind reading hints added next to the data in `formatReferences` (`KIND_HINT`) — not in prompt text. The site crawl honors robots.txt, reads ≤ 10 pages, and rejects shared hosts. Never store or read comments or follower data.
- References are read into a text snapshot in the request path (`ReferencesService`, no AI); runners only read the snapshot. Private Google Docs go through `GoogleDriveService` (encrypted refresh tokens via `SecretBox`).

## Docoo service API (docs/18-docoo-integration.md)
- `GET /api/integrations/docoo/{ping,businesses,businesses/:id/export}`: read-only, bearer `INTEGRATION_TOKEN` (route absent when unset), not tied to users/roles. The export document (`DocooBusinessExport` in `packages/shared/src/integration.ts`, built by the pure `buildDocooExport`) must stay deterministic apart from `exportedAt` — Docoo hashes it to detect changes — and must never contain people, files or secrets. Add fields additively; bump `DOCOO_EXPORT_SCHEMA_VERSION` only for breaking changes.
- Bee Researcher (docs/26-researcher-integration.md): `/api/integrations/researcher/...` reuses `DocooExportService` with its own `RESEARCHER_INTEGRATION_TOKEN` (off when unset or equal to `INTEGRATION_TOKEN`) and an allowlist (`RESEARCHER_BUSINESS_ACCESS` selected/all + `RESEARCHER_BUSINESS_IDS`); every query must pass `allowedIds()`, and a non-allowed id is a 404 before any DB read.

## Optional samples (docs/19-optional-samples.md)
- Sample contents are optional: `Topic.samplesSkippedAt` (set by `PUT /topics/:id/samples-skipped`) settles the `add_samples` / `analyze_samples` Walker steps. A topic with no analyzed samples (or skipped) gets the business's READY+active references as `documents` from `ContextLoader.business()`; `formatBusiness` appends them as `[DOCUMENTS]` in the `business` variable — never add a prompt variable for it.

## Tags & campaigns (docs/20-tags-campaigns.md)
- `Tag` and `Campaign` belong to one topic, so they are guarded with `@TopicScoped('tag' | 'campaign')`; a tag/campaign id from another topic is a 400 (`TagsService.assertInTopic`, the content PATCH check). Tag color is a plain string checked by `TagColor` in `packages/shared`. Delete leaves ideas/contents alone (links only).

## Review workflow (docs/21-review-workflow.md)
- Content status changes only through `POST /contents/:id/review/:action` (`ReviewsService.act`); `PATCH /contents/:id` refuses `status`. The rules live once in `packages/shared/src/workflow.ts` (`reviewActionsFor` / `applyReviewAction`); the API returns `review.actions` for the caller and the web only renders those — never re-derive roles in the client. Anything that changes reviewed text (manual edit, restore, AI revise) must call `ReviewsService.resetAfterEdit`. Comments are `@TopicScoped('comment')`.

## Calendar & publishing (docs/22-calendar-publishing.md)
- Only APPROVED content has `scheduledAt`; leaving APPROVED or changing the text clears it (`ReviewsService`). A content with `publishedAt` is frozen: edit/restore/AI revise and every review step answer 409 until unpublished. Publishing on platforms is manual — the app only records it. Calendar dates in the web come from `Intl` (`utils/calendar.ts`), never a hand-written Jalali converter.

## Repurposing, search & filters (docs/23-repurposing.md, docs/24-search-filters.md)
- `REPURPOSE_CONTENT` follows the core rule: the request path only creates the empty `Content` shells (`sourceContentId`, `platform`, `format`) and enqueues jobs; `RepurposeContentRunner` writes version 1. A content's platform is `platform ?? topic.platform` (`effectivePlatform`) — use it, never `topic.platform` alone. Text search must go through `matchAllWords` / `termVariants` (shared `search.ts`) so Arabic and Persian letter/digit spellings match; never plain `contains` on a raw query. Content list filters live in the URL (`features/contents/filters.ts`).

## Notifications (docs/25-notifications.md)
- Tell people through `NotificationsService.notify()` only (never insert `Notification` rows or call SMTP/webhook directly): recipients come from roles + `usersWithAccess` (project access), the actor is never a recipient, and a notification must never fail the action that caused it — `notify` swallows errors and callers wrap recipient lookups in try/catch. Message text is built once by `notificationMessage()` (shared) from stored `params`, never stored as text. `/notifications` routes are open to every role (`@Roles('ADMIN','EDITOR','VIEWER')`) because they are the caller's own data. The webhook secret is write-only (`SecretBox`) and delivery logs keep only the host.

## Topic & business access (docs/17-project-access.md)
- EDITOR/VIEWER only reach topics/businesses they created or the owner granted (`TopicMember` / `BusinessMember`, `AccessLevel` VIEW/EDIT); admins reach all; only the owner manages grants (`/owner/users/:id/...`). Every topic- or business-scoped route needs `@TopicScoped` / `@BusinessScoped` (from `common/access.ts`); every list of them or their data must apply `AccessService.visibleTopics()` / `visibleBusinesses()`. Web gates edit UI with `useCanEditTopic` / `useCanEditBusiness`, not `can('content:write')`.

## Smart (docs/10-smart.md)
- Walker steps: `WalkerStepKey` in `packages/shared/src/smart.ts`; server progress in `WalkerProgressService`, client routing in `apps/web/src/features/smart/walker-steps.ts`.
- Errors: 5xx are recorded by `AllExceptionsFilter` → `ErrorTrackerService`; browser errors go through `lib/smart-bus.ts` → `lib/error-reporter.ts`. Don't record 4xx.
- Detailed interaction logging is opt-in (`SystemSetting` key `smart`); always pass logged payloads through `sanitize()`.
- Walker issues ("دفتر خطاهای واکر") are the admin's bug reports — read them via `GET /api/smart/issues` or the DB table `WalkerIssue` when asked to fix reported problems.
