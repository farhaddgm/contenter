# راهنمای توسعه

## پیش‌نیازها
- Node.js 22 یا بالاتر، npm 10 یا بالاتر
- Docker (برای PostgreSQL و Redis)؛ یا PostgreSQL 15+ محلی و `QUEUE_DRIVER=inline` بدون Redis

## راه‌اندازی

```bash
npm install
cp apps/api/.env.example apps/api/.env      # مقادیر را تنظیم کنید
npm run db:up                               # Postgres + Redis با Docker
npm run build -w @contenter/shared
npm run db:migrate                          # prisma migrate dev
npm run db:seed                             # ادمین، پرامپت‌ها، اصول و موضوع نمونه
npm run dev                                 # shared (watch) + API :4000 + Web :5173
```

ورود پیش‌فرض: `admin@contenter.local` / `ChangeMe123!` (از `SEED_ADMIN_*`). **بعد از اولین ورود رمز را عوض کنید.**

### حالت بدون کلید API
با `AI_PROVIDER=mock` همهٔ جریان‌ها با خروجی آزمایشی معتبر کار می‌کنند. برای استفادهٔ واقعی:

```env
AI_PROVIDER=live
# کلید هر ارائه‌دهنده‌ای که استفاده می‌کنید (خالی = غیرفعال)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
AI_DEFAULT_MODEL=openai:gpt-5.4
```

سپس API را ری‌استارت کنید و در **پنل ← تنظیمات** مدل هر کار را انتخاب کنید.

### بدون Redis
`QUEUE_DRIVER=inline` کارها را درون همان پروسه (با retry) اجرا می‌کند. برای تولید از `bullmq` استفاده کنید.

## فرمان‌ها

| فرمان | کار |
|---|---|
| `npm run dev` | اجرای همهٔ بخش‌ها در حالت توسعه |
| `npm run build` | ساخت shared، api و web |
| `npm run lint` / `npm run typecheck` / `npm test` | کیفیت کد |
| `npm run format` | Prettier |
| `npm run prisma:studio -w @contenter/api` | مرورگر پایگاه داده |

## تست‌ها
- `packages/shared`: اسکیماها
- `apps/api`: استخراج رسانه و محافظت SSRF، رندر پرامپت، هزینه، سریال‌سازی کانتکست، گارد نقش، اعتبار خروجی MockProvider
- `apps/web`: کامپوننت‌های UI و i18n (Vitest + Testing Library)

## قراردادها
- اسکیمای هر ورودی/خروجی در `packages/shared` تعریف می‌شود و در API و فرم‌ها مشترک است.
- هر تغییر مهم دامنه با `AuditService.log()` ثبت می‌شود.
- هیچ فراخوانی AI درون درخواست HTTP انجام نمی‌شود؛ همیشه از `AiJobsService.enqueue()` استفاده کنید.
- تغییر schema با `npm run db:migrate` (یک مایگریشن جدید) همراه است.
- پیام‌های commit: [Conventional Commits](https://www.conventionalcommits.org/).

## انتشار نسخه

1. نسخه را در همهٔ `package.json`ها بالا ببرید (`npm version <x.y.z> --no-git-tag-version --workspaces --include-workspace-root`) و بخش همان نسخه را در `CHANGELOG.md` بنویسید.
2. commit با عنوان `chore(release): v<x.y.z> — <خلاصه>` بسازید و به `main` برسانید (مستقیم یا با PR).
3. تگ را دستی نسازید: workflow «Release tag» (`.github/workflows/release-tag.yml`) بعد از هر push به `main`، اگر تگ `v<نسخهٔ package.json>` وجود نداشته باشد، همان commit انتشار را با تگ annotated علامت می‌زند. از Actions هم دستی قابل اجراست (`workflow_dispatch`).
4. روی سرور `bash scripts/deploy.sh` ([13-operations.md](13-operations.md)) — پیام پایانی نام تگ را نشان می‌دهد.

