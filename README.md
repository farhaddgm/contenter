# Contenter

**پلتفرم تولید محتوای هوشمند** — نمونه‌محتوا بدهید؛ Contenter سبک را کشف می‌کند، ایده می‌دهد و محتوای هم‌سبک تولید می‌کند، با تأیید شما در هر مرحله. همراه با بک‌آفیس کامل.

> **قاعدهٔ طراحی:** تحلیل و تصمیم با AI؛ اجرا با کد. مدل فقط JSON معتبر (طبق اسکیما) برمی‌گرداند و بقیهٔ کارها — دریافت لینک، ذخیره، صف، نسخه‌بندی، هزینه، دسترسی — را کد سرور انجام می‌دهد.

## جریان کار (فاز ۱)

```
ادمین: موضوع + شرح + اصول
   │
   ├─► نمونه‌محتوا (لینک + متن اختیاری) ──► [کد] دریافت لینک، استخراج متادیتا و متن
   │                                          │
   │                                          ▼
   │                                   [AI] تحلیل هر نمونه
   │                                          │
   │                                          ▼
   │                         [AI] ساخت پروفایل سبک نسخه‌دار ──► [ادمین] تأیید/رد مشخصه‌ها
   │                                          │
   ├─► درخواست ایده‌پردازی ──► [AI] ایده‌ها بر پایهٔ پروفایل تأییدشده + اصول
   │                                          │
   └─► تولید محتوا (از ایده یا بریف) ──► [AI] پیش‌نویس + خودارزیابی ──► بازنویسی/ویرایش/تأیید
```

## فناوری‌ها

| لایه | انتخاب |
|---|---|
| بک‌اند | NestJS 11، Prisma 6 + PostgreSQL، BullMQ + Redis، Zod |
| AI | Claude (`claude-opus-5`) از طریق Anthropic SDK — Structured Outputs، adaptive thinking، prompt caching؛ ارائه‌دهندهٔ mock برای توسعه |
| فرانت‌اند | React 19، Vite، TanStack Query، React Router 7، Tailwind 4، Radix — معماری [bulletproof-react](https://github.com/alan2207/bulletproof-react)، RTL فارسی + انگلیسی، پوستهٔ روشن/تیره |
| مشترک | `packages/shared`: اسکیماهای Zod و انواع مشترک |

## شروع سریع

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run db:up && npm run build -w @contenter/shared
npm run db:migrate && npm run db:seed
npm run dev
```

- وب: http://localhost:5173 — API: http://localhost:4000/api
- ورود: `admin@contenter.local` / `ChangeMe123!`
- بدون کلید API با `AI_PROVIDER=mock` کار می‌کند؛ برای AI واقعی `AI_PROVIDER=anthropic` و `ANTHROPIC_API_KEY` را تنظیم کنید.

## مستندات

| سند | موضوع |
|---|---|
| [01 — چشم‌انداز و فازها](docs/01-vision-and-roadmap.md) | نقشهٔ راه ۶ فاز |
| [02 — معماری](docs/02-architecture.md) | لایه‌ها، صف، امنیت |
| [03 — مدل داده](docs/03-domain-model.md) | موجودیت‌ها |
| [04 — خط لولهٔ AI](docs/04-ai-pipeline.md) | مرز AI/کد، پرامپت‌ها، هزینه |
| [05 — API](docs/05-api.md) | مرجع endpointها |
| [06 — فرانت‌اند](docs/06-frontend.md) | ساختار و الگوها |
| [07 — بک‌آفیس](docs/07-backoffice.md) | ابزارهای مدیریت |
| [08 — توسعه](docs/08-development.md) | راه‌اندازی و قراردادها |
| [09 — استقرار](docs/09-deployment.md) | Docker، مقیاس، چک‌لیست تولید |

## ساختار

```
apps/api        NestJS: HTTP API + AI worker
apps/web        React SPA (پنل محتوا + بک‌آفیس)
packages/shared Zod schemas & types
docs/           مستندات
```
