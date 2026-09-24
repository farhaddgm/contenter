# معماری سیستم

## نمای کلی

```
┌──────────────────────────┐        ┌──────────────────────────────────────────────┐
│  apps/web (React + Vite)  │  HTTP  │  apps/api (NestJS)                            │
│  - پنل تولید محتوا        │ ─────► │  ┌────────────┐  ┌──────────────────────────┐ │
│  - بک‌آفیس                 │  JSON  │  │ HTTP API   │  │ Worker (BullMQ consumer) │ │
│  - TanStack Query (poll)  │ ◄───── │  │ Controllers│  │  - ai.processor          │ │
└──────────────────────────┘        │  └─────┬──────┘  └───────────┬──────────────┘ │
                                    │        │ enqueue              │ execute        │
                                    │        ▼                      ▼                │
                                    │  ┌──────────┐   ┌──────────────────────────┐  │
                                    │  │  Redis   │   │ AI Layer                  │  │
                                    │  │ (queue)  │   │  AiProvider ◄─ Anthropic  │  │
                                    │  └──────────┘   │             ◄─ Mock       │  │
                                    │                 │  PromptService (DB)       │  │
                                    │                 │  Zod-validated outputs    │  │
                                    │                 └──────────────────────────┘  │
                                    │  ┌──────────────────────────────────────────┐ │
                                    │  │ PostgreSQL (Prisma)                      │ │
                                    │  └──────────────────────────────────────────┘ │
                                    └──────────────────────────────────────────────┘
```

API و Worker از یک کدبیس ساخته می‌شوند و با متغیر `APP_ROLE` (`api`، `worker` یا `all`) جدا اجرا می‌شوند. در توسعهٔ محلی `all` است. در تولید، API و Worker جداگانه مقیاس می‌گیرند.

## ساختار مونوریپو

```
Contenter/
├── apps/
│   ├── api/                  # NestJS: HTTP API + Worker
│   │   ├── prisma/           # schema.prisma، migrations، seed
│   │   └── src/
│   │       ├── common/       # گاردها، دکوریتورها، پایپ Zod، فیلتر خطا
│   │       ├── config/       # بارگذاری و اعتبارسنجی env
│   │       ├── infra/        # prisma، queue
│   │       └── modules/
│   │           ├── auth/         # ورود، توکن، نقش‌ها
│   │           ├── users/        # مدیریت کاربران (بک‌آفیس)
│   │           ├── topics/       # موضوع‌ها و اصول
│   │           ├── samples/      # نمونه‌ها + MediaFetcher (بدون AI)
│   │           ├── profiles/     # پروفایل محتوایی و مشخصه‌ها
│   │           ├── ideas/        # ایده‌ها
│   │           ├── contents/     # محتوای تولیدی و نسخه‌ها
│   │           ├── ai/           # Provider، پرامپت‌ها، اجراکننده‌ها، پردازشگر صف
│   │           ├── jobs/         # نمایش و مدیریت AiJob
│   │           ├── settings/     # تنظیمات سیستم
│   │           ├── audit/        # لاگ ممیزی
│   │           └── dashboard/    # آمار
│   └── web/                  # React (bulletproof-react style)
│       └── src/
│           ├── app/          # روتر، پرووایدرها، صفحات (routes)
│           ├── components/   # UI مشترک (ui/، layouts/، …)
│           ├── config/       # env، مسیرها
│           ├── features/     # هر دامنه: api/ components/ types
│           ├── hooks/ lib/ i18n/ stores/ utils/ testing/
└── packages/
    └── shared/               # اسکیماهای Zod، enumها، انواع مشترک
```

## اصول لایه‌بندی بک‌اند

- **Controller:** فقط دریافت، اعتبارسنجی (ZodValidationPipe) و پاسخ
- **Service:** منطق دامنه، دسترسی به Prisma و ثبت Audit
- **AI Runner:** برای هر نوع کار AI یک اجراکننده (`AnalyzeSampleRunner`، `BuildProfileRunner`، `IdeateRunner`، `GenerateContentRunner`، `ReviseContentRunner`) وجود دارد. هر اجراکننده ورودی را از DB می‌خواند، پرامپت را می‌سازد، `AiProvider` را صدا می‌زند، خروجی را اعتبارسنجی می‌کند و نتیجه را **با کد** ذخیره می‌کند.
- **Queue:** اجراکننده‌ها فقط از ورکر صدا زده می‌شوند. دو درایور داریم: `bullmq` (پیش‌فرض، Redis) و `inline` (برای تست و محیط بدون Redis).

## جریان یک کار AI

1. کاربر دکمه‌ای را می‌زند، مثلاً «تحلیل نمونه».
2. API یک رکورد `AiJob` با وضعیت `QUEUED` می‌سازد و شناسهٔ آن را در صف می‌گذارد. پاسخ `202` همراه `jobId` برمی‌گردد.
3. ورکر کار را برمی‌دارد، وضعیت را `RUNNING` می‌کند و Runner مربوط را اجرا می‌کند.
4. Runner پرامپت فعال را از `PromptTemplate` می‌خواند و `AiProvider.generateStructured()` را با اسکیمای Zod صدا می‌زند.
5. خروجی اعتبارسنجی می‌شود. نتیجه در جداول دامنه ذخیره می‌شود و `AiJob` با خروجی، توکن و هزینه به `SUCCEEDED` می‌رود.
6. در صورت خطا، BullMQ تا سقف تعیین‌شده با backoff نمایی دوباره تلاش می‌کند و در پایان وضعیت `FAILED` با پیام خطا ثبت می‌شود. ادمین از بک‌آفیس می‌تواند دوباره اجرا کند.
7. فرانت با TanStack Query وضعیت کار را poll می‌کند و پس از پایان، داده‌های مرتبط را invalidate می‌کند.

## امنیت

- رمزها با `argon2` هش می‌شوند.
- توکن دسترسی JWT کوتاه‌عمر است و در حافظهٔ فرانت نگه داشته می‌شود. توکن تازه‌سازی در کوکی `httpOnly`، `SameSite=Lax` قرار دارد و در DB چرخشی است.
- گارد نقش روی هر endpoint: `@Roles('ADMIN')` و…
- MediaFetcher از **SSRF** جلوگیری می‌کند: فقط `http(s)`، رد IPهای خصوصی و loopback، سقف حجم و timeout.
- هر تغییر مهم در `AuditLog` ثبت می‌شود.
- محتوای دریافتی از لینک‌ها **داده** است، نه دستور. در پرامپت‌ها داخل تگ‌های مشخص قرار می‌گیرد و به مدل گفته می‌شود دستورهای داخل آن را اجرا نکند.

## انتخاب‌های فنی و دلیل آن‌ها

| انتخاب | دلیل |
|---|---|
| NestJS | ماژولار، DI، مناسب تیم و مقیاس، اکوسیستم بالغ |
| Prisma + PostgreSQL | اسکیمای تایپ‌شده، مایگریشن، JSONB برای داده‌های AI |
| BullMQ + Redis | صف پایدار، retry و backoff، مقیاس افقی ورکرها |
| Zod (مشترک) | یک قرارداد برای اعتبارسنجی API، فرم‌ها و خروجی AI |
| Claude (Anthropic SDK) | خروجی ساختاریافته (Structured Outputs)، کیفیت تحلیل و نگارش فارسی |
| React + Vite + TanStack Query | الگوی bulletproof-react: feature-based، کش سرور و poll ساده |
| Tailwind + Radix | کامپوننت‌های قابل‌دسترس با پشتیبانی RTL |
