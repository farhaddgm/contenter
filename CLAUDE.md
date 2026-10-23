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
- Mixed Persian/English text: never `dir="auto"` (it follows the first letter, so a sentence starting with English renders LTR). Use `data-bidi=""` (`lib/bidi.ts`: RTL if any Arabic-script letter, LTR only for Latin-only); rendered Markdown blocks get it automatically.
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

## Business boundary (docs/63-business-boundary.md)
- Outside `modules/businesses`, read a business only through `BusinessApi` (`business-api.ts`, global, read-only): add a narrow typed method instead of querying `prisma.business*`. ESLint `no-restricted-syntax` enforces it; the allowlist (businesses module, business AI runners, `common/access.ts`, `users.module.ts` grants, specs) lives in `apps/api/eslint.config.mjs` and docs/63 §5. Tests construct it with the same mock: `new BusinessApi(prisma)`. Content-side features (pillars, checklist, stale, golden) are not part of it.

## Imitation styles (docs/64-business-styles.md)
- `BusinessStyle` (named, several per business) + `StyleSource` (Instagram / site / page / text of **other** brands, never the business's own, so they stay out of `BusinessReference`, the profile, Docoo/Researcher exports and similarity). Sources are read by code in the request path (`StylesService`, same Instagram rules as docs/28: never instagram.com, Graph API or hand-typed data); `BUSINESS_STYLE_BUILD` only interprets them and the runner stores `summary`/`traits`/`guide`/`caveats` with `reviewedAt = null`. Editing `summary`/`guide` or `POST …/review` confirms it. A project's `Topic.styleId` must be a built **and** confirmed style of its own business (`TopicsService.assertStyle`, re-checked when the business changes; a business change without a style drops it). `BusinessApi.styleForPrompt` is the only reader for prompts; `ContextLoader.business` adds `[STYLE]` inside the `business` variable only for drafts (`target`), with its own precedence line — never edit the generate/repurpose prompt for it (eval guard).

## Context preview (docs/66-business-context-preview.md)
- `formatBusiness` is exactly the blocks of `buildBusinessParts` (`HEAD`, `SECTION:<key>`, `FACTS`, `TERMS`, `ASSETS`, `DOCUMENTS`, `EXAMPLES`, `STYLE`) joined by a blank line. A new prompt block goes in as a part there, so the preview shows it and an empty block leaves the bytes unchanged. `GET /businesses/:id/context-preview` (`ContextPreviewService`) builds its report from those parts: no model call, and it never indexes or embeds (`ContextLoader.business(..., { semantic: false })`). Sizes are counted by code; tokens and cost are **estimates** — `AiJob.promptChars` (summed in `batchContext` by `AiExecutor.execute`, null for web-research/image jobs) calibrates characters per token (`calibrateRatio`, default until 20 jobs), and cost is shown to admins only. Version 1 only shows and warns: don't add automatic trimming or a total cap without measuring first.

## Catalog (docs/67-business-catalog.md)
- `BusinessOffering` (products, services, plans, bundles: name + aliases, status, push level, price as `Decimal` + currency + unit + validity) is the structured source for prices and availability; the `SERVICES` section stays the narrative. Only rows that are `isActive && verified` reach `[CATALOG]` (a part of the `business` variable, after `[FACTS]`; empty = same bytes as before), `BusinessApi.offeringsForQuality` / the content detail check, and the Docoo/Researcher `offerings` export (additive, no `note`/`evidence`). A price shows to the model only while valid; currency is always given and nothing is converted (toman ≠ rial; the check compares them through ×10).
- The quality gate compares only **numbers next to a currency word/symbol** (`extractPrices`, `comparePrice`) — `OFFERING_PRICE_MISMATCH` / `OFFERING_UNAVAILABLE` are `warn` only, an expired price reuses `FACT_EXPIRED`, and only the price code is in `STALE_CODES`. Never let the model judge a price.
- `BUSINESS_OFFERINGS_EXTRACT` follows the core rule: the model proposes; `resolveOfferingProposals` (code) keeps a row only if its quote occurs in the text the model was given, and keeps a price only if that quote states that amount in that currency. Proposed rows are saved `source: AI`, `verified: false`, `isActive: false` and switch on only through `POST /business-offerings/:id/confirm` (a PATCH `isActive: true` on an unconfirmed row is a 400). The `businessOffering` delegate is in the docs/63 lint rule; add the runner there if you add another one.

## Section lock (docs/69-business-section-lock.md)
- `BusinessSection.lock` (`NONE | AI_ONLY | ADMIN_ONLY`, set by admins only via `PUT /businesses/:id/sections/:key/lock`) decides who may change a section's text. **Every write of a section goes through `writeSection`**, which takes a required `actor` (`{ kind: 'AI' }` or `{ kind: 'USER', role }`) and enforces `isWriteBlocked` with a compare-and-set on the lock; a test fails if any other code writes `businessSection` (only `section-writer.ts` and `profile-knowledge.service.ts` may). The AI never gets a `SectionLockedError`: a runner checks `aiMustSuggest(section.lock)` first and saves a `BusinessSuggestion` instead (`BUSINESS_BUILD`, and `BUSINESS_REVISE` in `DIRECT` mode, where the held key stays out of the note's `changedKeys`). New AI paths that write sections must do the same. Locking never changes `updatedAt`, and the note is not audit-logged. The web hides write buttons for non-admins on `ADMIN_ONLY`, but the server is the guard.

## UI design language (docs/56-ui-redesign.md)
- Web follows Bee Researcher's "honey" language: colors, radii and shadows only through the tokens in `apps/web/src/index.css` (never hard-coded hex/indigo); controls `rounded-control` (40px), cards `Card`/`rounded-xl`, floating panels `shadow-pop`. Primary is `#a35c05` (AA with white text). Page titles only via `PageHeader` — write the primary action **first**; it renders last in reading order. Accessibility labels come from `t(...)`. Smart starts minimized.

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

## Publishing checklist (docs/45-publish-checklist.md)
- Per-business `ChecklistTemplate` (platform null = all) + per-content `ContentChecklistTick`; points keep their `id` across edits. An open **required** point makes `CalendarService.schedule` answer 409 (unscheduling is always free); approval and "mark published" are never blocked. `auto: 'QUALITY_CLEAN'` points are answered by the quality gate, are never required and never block. Ticks are cleared in `ReviewsService.resetAfterEdit` (when reviewed/approved text goes back to DRAFT).

## AI feedback (docs/46-ai-feedback.md)
- `AiFeedback` is one 👍/👎 per (user, target) on an AI-written `CONTENT_VERSION` (`source = AI`) or an AI-built `PROFILE` (has `jobId`); each vote stores the producing `jobId` so prompt version/model come from `AiJob`. Voting needs topic VIEW and is open to every role (`@Roles(...)` on the controller); reason/note only with 👎; the note stays out of the audit log. The summary is counted by `buildFeedbackSummary`, never by the model.

## Readability (docs/47-readability.md)
- `analyzeReadability` (shared, pure) counts sentence length, long sentences, word length, Latin share and stiff phrases (`DEFAULT_STIFF_PHRASES` + admin `SystemSetting` `readability`); `ContentsService.detail` returns it as `readability`. It is approximate and informational only: never add it to `quality.warnings`, the checklist's `QUALITY_CLEAN`, or any review/schedule guard. Under `MIN_READABILITY_WORDS` it raises no note.

## Similarity (docs/48-similarity.md)
- `contentSimilarity` (shared, pure: `fold` → 4-word shingles → max(Jaccard, containment)) is run by `SimilarityService` inside `ContentsService.detail` against contents, ideas, samples and READY references of the business, never against anything outside `visibleTopics(user)` (references need business VIEW) and never against the content's own source/siblings/idea. Thresholds live in `SystemSetting` `similarity`. Literal only (no embeddings) and warn-only: don't add it to `quality.warnings` or any guard.

## Golden examples (docs/49-golden-examples.md)
- `Content.goldenAt` is set only by an admin (`PUT /contents/:id/golden`) on APPROVED/published content of a project with a business, and cleared in `ReviewsService.resetAfterEdit`. `ContextLoader.business(topicId, target)` adds `examples` only when a draft is being written (`GENERATE_CONTENT`, `REPURPOSE_CONTENT`), re-checking approved/published at read time and excluding the content and its source; `formatBusiness` appends them as `[EXAMPLES]` inside the existing `business` variable — never a new prompt variable, and unchanged bytes when there are none. Limits live in `SystemSetting` `golden`.

## Coverage map (docs/50-coverage-map.md)
- `ContentPillar` (per business, ≤ 12, optional `targetShare`) and `Content.pillarId`; a pillar must belong to the content's topic's business (`CoverageService.assertForTopic`, 400 otherwise). Saving pillars replaces the list by id (a removed pillar leaves its contents unlabeled). The map is `buildCoverage` (shared, pure) over APPROVED/published contents, only from `visibleTopics`; unlabeled content always has its own row and shares use labeled content only (< 5 → no comparison). Labels are set by people; the model labels nothing.

## Draft variants (docs/51-draft-variants.md)
- `variants` (1–3, capped by `SystemSetting` `variants`) on `POST /topics/:id/contents/generate` creates N empty contents sharing `variantGroupId` plus one `GENERATE_CONTENT` job each; the angle (`VARIANT_ANGLES`, fixed in shared, handed out in order — never chosen by the model) is stored on `Content.variantAngle` and appended to that job's `brief` variable by `withAngle` (don't edit the prompt template for it: the eval prompt guard). Picking (`planPick`, pure) sends the group's other DRAFT/FAILED contents to REJECTED with a review-history row — never deletes — and refuses while any is GENERATING. The compare numbers are counted by code; similarity checks skip the content's own variant group.

## Personal API keys & /api/v1 (docs/52-api-keys.md)
- A bearer token starting `ctk_` is an API key: `JwtAuthGuard` accepts it **only** on handlers marked `@AllowApiKey(scope)` (403 everywhere else, before any lookup) — never add that decorator to a review/approval/schedule/publish/edit route or to key management; `api-key-guard.spec.ts` pins the exact set. The key speaks for its owner with the owner's *current* role (inactive owner → 401, demoted owner loses write scopes), only a SHA-256 is stored, the whole key is returned once at creation and never logged or audited. `/api/v1` documents (`ApiV1*` in shared) only ever gain fields. ≤ 5 active keys per user, default expiry 90 days.

## StyleFit (docs/53-style-fit.md)
- `styleStats` / `targetsFromTexts` / `targetsFromInstagram` / `assessStyleFit` (shared, pure) compare the draft's eight counts with a range from ≥ 3 analyzed samples of the topic, else from the business's Instagram averages (≥ 6 posts, needs business VIEW); no data → no card, too few → "not enough data". It says "inside the statistical range", never that the text "reads like the brand", and never blocks. Don't derive ranges from the model's `SampleAnalysis` JSON — they come from the raw sample text.

## Deep health & metrics (docs/54-ops-metrics.md)
- Worker processes write a Redis heartbeat (`contenter:worker:<host>:<pid>`, 30 s / 90 s TTL, `QueueService.startHeartbeat`); `OpsMetricsService` builds `/api/health`'s `worker`/`queue` and `/api/metrics` from `AiJob` rows + heartbeats. `evaluateHealth` turns `status` degraded only for db/redis down, no worker **after `WORKER_STARTUP_GRACE_SECONDS` (> deploy.sh's 150 s wait)**, or a job waiting > 15 min — never lengthen deploy risk by making a new check red during startup. `/api/metrics` exists only with its own `METRICS_TOKEN` (404 otherwise or if it equals another service token); metric labels are limited to `ALLOWED_LABELS` (no user/business/topic ids) — `renderPrometheus` throws on others.

## Bulk export (docs/55-bulk-export.md)
- `POST /contents/export` builds Markdown/CSV/DOCX/ZIP in memory from the **current version** of ≤ `EXPORT_MAX_ITEMS` contents the caller can see (`visibleTopics`; a missing/hidden id is one indistinguishable 404). Text formats live in `packages/shared/src/export.ts`, DOCX/ZIP packaging (`jszip`, fixed entry dates, deterministic) in `modules/export`. Every CSV text cell goes through `csvCell` (formula-injection guard `'` prefix, BOM, CRLF) — never write a CSV cell any other way. Not reachable with an API key.

## Repurposing, search & filters (docs/23-repurposing.md, docs/24-search-filters.md)
- `REPURPOSE_CONTENT` follows the core rule: the request path only creates the empty `Content` shells (`sourceContentId`, `platform`, `format`) and enqueues jobs; `RepurposeContentRunner` writes version 1. A content's platform is `platform ?? topic.platform` (`effectivePlatform`) — use it, never `topic.platform` alone. Text search must go through `matchAllWords` / `termVariants` (shared `search.ts`) so Arabic and Persian letter/digit spellings match; never plain `contains` on a raw query. Content list filters live in the URL (`features/contents/filters.ts`).

## Notifications (docs/25-notifications.md)
- Tell people through `NotificationsService.notify()` only (never insert `Notification` rows or call SMTP/webhook directly): recipients come from roles + `usersWithAccess` (project access), the actor is never a recipient, and a notification must never fail the action that caused it — `notify` swallows errors and callers wrap recipient lookups in try/catch. Message text is built once by `notificationMessage()` (shared) from stored `params`, never stored as text. `/notifications` routes are open to every role (`@Roles('ADMIN','EDITOR','VIEWER')`) because they are the caller's own data. The webhook secret is write-only (`SecretBox`) and delivery logs keep only the host.

## Topic & business access (docs/17-project-access.md)
- EDITOR/VIEWER only reach topics/businesses they created or the owner granted (`TopicMember` / `BusinessMember`, `AccessLevel` VIEW/EDIT); admins reach all; only the owner manages grants (`/owner/users/:id/...`). Every topic- or business-scoped route needs `@TopicScoped` / `@BusinessScoped` (from `common/access.ts`); every list of them or their data must apply `AccessService.visibleTopics()` / `visibleBusinesses()`. Web gates edit UI with `useCanEditTopic` / `useCanEditBusiness`, not `can('content:write')`.

## Learning from edits (docs/30-learn-from-edits.md)
- `LEARN_FROM_EDITS` follows the core rule: code finds the (last AI version, approved admin version) pairs (`collectEditPairs`) and computes every diff (`edit-diff.ts`, folded word diff); the model only names patterns and points at pair ids (`P1`…); `resolveSuggestions` drops a suggestion with < 2 real pairs, a repeat, or made-up ids, and builds the evidence from the real pairs — never store what the model wrote as evidence. A `LearningSuggestion` becomes a `Principle` only through `POST /learning-suggestions/:id/accept` (admin). `category` is a plain string checked by `EditCategory` in `packages/shared`.

## Smart (docs/10-smart.md)
- Walker steps: `WalkerStepKey` in `packages/shared/src/smart.ts`; server progress in `WalkerProgressService`, client routing in `apps/web/src/features/smart/walker-steps.ts`.
- Errors: 5xx are recorded by `AllExceptionsFilter` → `ErrorTrackerService`; browser errors go through `lib/smart-bus.ts` → `lib/error-reporter.ts`. Don't record 4xx.
- Detailed interaction logging is opt-in (`SystemSetting` key `smart`); always pass logged payloads through `sanitize()`.
- Walker issues ("دفتر خطاهای واکر") are the admin's bug reports — read them via `GET /api/smart/issues` or the DB table `WalkerIssue` when asked to fix reported problems.

## Quality gate, performance numbers, Persian eval (docs/40–43)
- Iranian platforms (`EITAA`, `BALE`, `RUBIKA`, `APARAT`, `NEWSLETTER`) are in `Platform` (Prisma + shared). Official messenger API facts and their confidence are in docs/40; publishing to them is not built.
- Pre-publish checks are code only (`packages/shared/src/quality.ts`, `checkContentQuality`), returned as `quality` by `GET /contents/:id`; they warn and never block a review step or a publish. Platform limits live once in `PLATFORM_RULES` — an empty number means "not checked", never "no limit". Never let a model decide whether a text passes.
- Performance numbers are typed or pasted by hand (`ContentMetric`, one reading per content and day, only for published content, docs/42). The paste parser accepts Gregorian dates only; do not hand-write a Jalali converter.
- Eval (`apps/api/src/evals`, docs/43): editing `prompts/defaults.ts` for `generate_content`, `repurpose_content` or `ideate` fails the `prompt change guard` test until `npm run eval -w @contenter/api -- --model … --judge … --update-baseline` records a full run. The judge must be from another vendor than the writer and must pass calibration. Tests must never write the real `eval-baseline.json` / `evaluated-prompts.json` (pass temp paths to `recordBaseline`).

## Reliability and cost (docs/60)
- A vendor that is out of credit, refuses the key or is down is a `ProviderUnavailableError` / `ProviderOverloadedError` (thrown by the providers); `AiExecutor.withFallback` then runs the call once on `AiSettings.fallbackModel`. A request the model itself rejects (`NonRetryableAiError`) is never retried on another model.
- Monthly budget: `BudgetService` (never block or throw in the request path except via `AiJobsService.enqueue` recording the job as FAILED when `hardStop` is on). Month = Persian by default, read with `Intl` (`monthRange`), not a converter.
- Economy mode (`AiJob.economy`, `ECONOMY_TASKS` only): a run stores its model request in `AiBatchCall` and throws `JobDeferredError`; `AiBatchService` submits/collects batches and wakes the job, which runs again and replays earlier calls by position. Runners must stay re-runnable (no side effects before the model call) and must not call `execute` conditionally on mutable state. A failed batch falls back to a live call.
- Semantic retrieval: embeddings are made only by the `EMBED_REFERENCE` job; `SemanticRetriever` picks chunks with cosine in code and falls back to the equal-share text whenever anything is missing. No pgvector on purpose (docs/60 §4).
- Browser tests live in `e2e/`; each test signs in on its own (refresh tokens rotate; a shared saved session breaks).

## AI keys in the admin page (docs/62)
- Vendor keys saved at `PUT /admin/settings/ai-keys` live sealed (`SecretBox`, purpose `ai-keys`) in `SystemSetting` `ai-keys` and win over `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. `AiProviderRegistry` reloads them every 15 s (API and worker are separate processes) via `setApiKey` on the providers. The plain key must never reach a response, log or audit row — only `keySource` and the last four characters (`keyHint`).

## Occasions, language register, stale content (docs/61)
- Occasions are `occasionsBetween` (shared, pure, `Intl` — no hand-written converter), computed in the browser. Islamic-calendar days are `approximate` (±1–2 days); never present them as official dates. A `MOURNING` occasion must not be paired with promotional wording. The ideate link only fills the `direction` field (`?direction=`); never edit the ideate prompt for it.
- `Business.register` (`LanguageRegister`, null = unset) adds one line to the `business` prompt variable (`registerInstruction`) and drives two `info` notes in the quality gate (`REGISTER_COLLOQUIAL` / `REGISTER_STIFF` from `registerMarkers`). They never become `warn`, never touch the checklist's `QUALITY_CLEAN`, and the model never judges register. `register-enum.ts` is separate from `register.ts` to avoid an import cycle with `business.ts`.
- Stale content (`findStale`, `GET /businesses/:id/stale-contents`) is the quality gate's `FACT_EXPIRED` / `FACT_NUMBER_MISMATCH` run over the business's approved/published contents (`visibleTopics` applies). List only; it changes nothing.
