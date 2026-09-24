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
