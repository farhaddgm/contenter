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
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_DEFAULT_MODEL=claude-opus-5
```

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
