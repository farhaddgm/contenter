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
- References are read into a text snapshot in the request path (`ReferencesService`, no AI); runners only read the snapshot. Private Google Docs go through `GoogleDriveService` (encrypted refresh tokens via `SecretBox`).

## Project access (docs/17-project-access.md)
- EDITOR/VIEWER only reach topics they created or were granted (`TopicMember`, VIEW/EDIT); admins reach all. Every topic-scoped route needs `@TopicScoped(via, param)`; every list of topics or their data must apply `TopicAccessService.visibleWhere()`. Web gates edit UI with `useCanEditTopic(topicId)`, not `can('content:write')`.

## Smart (docs/10-smart.md)
- Walker steps: `WalkerStepKey` in `packages/shared/src/smart.ts`; server progress in `WalkerProgressService`, client routing in `apps/web/src/features/smart/walker-steps.ts`.
- Errors: 5xx are recorded by `AllExceptionsFilter` → `ErrorTrackerService`; browser errors go through `lib/smart-bus.ts` → `lib/error-reporter.ts`. Don't record 4xx.
- Detailed interaction logging is opt-in (`SystemSetting` key `smart`); always pass logged payloads through `sanitize()`.
- Walker issues ("دفتر خطاهای واکر") are the admin's bug reports — read them via `GET /api/smart/issues` or the DB table `WalkerIssue` when asked to fix reported problems.
