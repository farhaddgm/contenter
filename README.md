# Contenter

**پلتفرم تولید محتوای هوشمند** — نمونه‌محتوا بدهید؛ Contenter سبک را کشف می‌کند، ایده می‌دهد و محتوای هم‌سبک تولید می‌کند، با تأیید شما در هر مرحله. همراه با بک‌آفیس کامل.

> **قاعدهٔ طراحی:** تحلیل و تصمیم با AI؛ اجرا با کد. مدل فقط JSON معتبر (طبق اسکیما) برمی‌گرداند و بقیهٔ کارها — دریافت لینک، ذخیره، صف، نسخه‌بندی، هزینه، دسترسی — را کد سرور انجام می‌دهد.

## جریان کار (فاز ۱)

```
ادمین: کسب‌وکار (دستی، با پیشنهاد AI، یا ساخت خودکار از کلیدواژه با تحقیق وب)
   │  پروفایل کسب‌وکار به همهٔ کارهای AI پروژه‌های متصل داده می‌شود
   ▼
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
| بک‌اند | NestJS 12، Prisma 6 + PostgreSQL، BullMQ + Redis، Zod |
| AI | Claude (Anthropic SDK) و GPT (OpenAI SDK) — مدل هر کار از پنل تنظیمات؛ Structured Outputs؛ ارائه‌دهندهٔ mock برای توسعه |
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
- بدون کلید API با `AI_PROVIDER=mock` کار می‌کند؛ برای AI واقعی `AI_PROVIDER=live` و `OPENAI_API_KEY` و/یا `ANTHROPIC_API_KEY` را تنظیم کنید.

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
| [10 — اسمارت](docs/10-smart.md) | واکر، گفتگو با AI، خطایاب، دفتر خطاهای واکر، لاگ تعاملات |
| [11 — ورود با گوگل](docs/11-google-login.md) | ورود با جیمیل، مالک، فهرست جیمیل‌های مجاز، راه‌اندازی Google Cloud |
| [12 — کسب‌وکارها](docs/12-businesses.md) | پروفایل کسب‌وکار، پیشنهاد AI، ساخت خودکار با تحقیق وب، اتصال به پروژه‌ها |
| [13 — نگهداری سرور](docs/13-operations.md) | انتشار با یک دستور، پشتیبان، بازیابی تنظیمات، دیسک پر |
| [18 — اتصال به Docoo](docs/18-docoo-integration.md) | API فقط‌خواندنی کسب‌وکار برای Docoo، توکن، قرارداد خروجی |
| [28 — پروفایل از اینستاگرام و سایت](docs/28-instagram-website-profile.md) | ساخت پروفایل کسب‌وکار از حساب اینستاگرام و سایت: ایده‌ها، بنچ‌مارک، تحقیق، طراحی، راه‌اندازی |

تاریخچهٔ نسخه‌ها: [CHANGELOG.md](CHANGELOG.md)

## ساختار

```
apps/api        NestJS: HTTP API + AI worker
apps/web        React SPA (پنل محتوا + بک‌آفیس)
packages/shared Zod schemas & types
docs/           مستندات
```

## مجوز

همهٔ حقوق محفوظ است ([LICENSE](LICENSE)). عمومی بودن مخزن به معنی اجازهٔ استفاده یا بازنشر نیست. اگر قرار است پروژه متن‌باز شود، فقط فایل `LICENSE` و فیلد `license` در `package.json`ها را عوض کنید.
