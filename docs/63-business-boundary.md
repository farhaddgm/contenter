# مرز ماژول کسب‌وکار (docs/63)

هدف: «هویت کسب‌وکار» (پروفایل، بخش‌ها، facts، اصطلاحات، رفرنس‌ها، دارایی‌ها، یادداشت‌ها، خروجی Docoo/Researcher) پشت **یک دروازهٔ فقط‌خواندنی** باشد تا اگر روزی لازم شد جدا شود (سرویس مستقل)، فقط همین دروازه جایگزین شود. فعلاً **جداسازی دیپلوی انجام نمی‌شود** (بخش ۷).

## ۱. تصمیم‌ها
| پرسش | انتخاب |
| --- | --- |
| اجراکننده‌های AI کسب‌وکار (`business.runners`، `business-extra.runners`، `embed-reference`) | در `modules/ai/runners` می‌مانند؛ در فهرست استثنای ESLint صریح‌اند (طبق قانون هستهٔ پروژه: runner خروجی مدل را ذخیره می‌کند) |
| دامنهٔ دروازه | **فقط خواندنی**. نوشتن فقط در `modules/businesses` و runnerهای بالا |
| محل دروازه | `apps/api/src/modules/businesses/business-api.ts` (`BusinessApi` + `BusinessApiModule` سراسری) |

## ۲. دروازه: `BusinessApi`
| متد | کاربرد | مصرف‌کننده |
| --- | --- | --- |
| `styleForPrompt(businessId, styleId)` | سبک ساخته‌شده و تأییدشدهٔ پروژه (docs/64) | `ContextLoader`، `TopicsService` |
| `names(ids)` | نام کسب‌وکارها | `BudgetService` |
| `promptProfile(id)` | پروفایل با مجموعهٔ پرامپت (`BUSINESS_PROMPT_INCLUDE`) | `ContextLoader` |
| `readableReferences(id, {order, take})` | رفرنس‌های READY و فعال با متن | `ContextLoader`، `SimilarityService` |
| `standingNotes(id, exceptId?)` | یادداشت‌های فعال | `ContextLoader` (و runnerها از طریق آن) |
| `activeFacts(id)` | facts فعال | `StaleService` |
| `instagramStats(id)` | آمار اینستاگرام (محاسبه‌شده با کد) | `StyleFitService` |
| `materialForTopic(topicId)` | شمار بخش‌های پرشده و رفرنس‌های خواندنی | `ProfilesService.build` |
| `countAll` / `listSummaries` / `findForExport` | خروجی یکپارچه‌سازی‌ها | `DocooExportService` |

`BUSINESS_PROMPT_INCLUDE`، `EXPORT_INCLUDE` و `ExportRow` از همین فایل می‌آیند. قراردادهای داده (Zod و انواع) همان‌جا در `packages/shared` می‌مانند.

## ۳. چه چیزی «هویت کسب‌وکار» است و چه چیزی «عملیات محتوا»
- **هویت (پشت دروازه):** `Business`، `BusinessSection(Revision)`، `BusinessFact`، `BusinessTerm`، `BusinessReference`، `BusinessNote`، `BusinessAsset`، `BusinessAudit`، `BusinessSuggestion`، `BusinessDiscovery`، `BusinessMember`.
- **عملیات محتوا (در Contenter می‌ماند، به `Content`/review وابسته است):** `ContentPillar` و coverage، `ChecklistTemplate`، stale-contents، نمونه‌های طلایی (golden)، register و بررسی‌های quality.

## ۴. قانون ESLint
`apps/api/eslint.config.mjs` (شامل `BusinessStyle` و `StyleSource` و runner `business-style.runner.ts` در فهرست استثنا) قاعدهٔ `no-restricted-syntax` دارد: هر `prisma.business*` / `this.prisma.business*` / `tx.business*` خارج از فهرست مجاز، خطای lint است (`npm run lint`). فقط دسترسی از طریق delegate بررسی می‌شود؛ فیلتر رابطه‌ای از سمت `Topic` (مثل `topic.business`، `where: { business: … }`) آزاد است چون `Topic.businessId` کلید خارجی است.

## ۵. فهرست استثنا (بدهی مرزی)
| فایل | چرا | وضعیت |
| --- | --- | --- |
| `modules/businesses/**` | مالک جدول‌هاست | دائمی |
| `modules/ai/runners/business.runners.ts`، `business-extra.runners.ts`، `embed-reference.runner.ts` | نوشتن خروجی مدل | موقت: اگر روزی runnerها به `modules/businesses` رفتند حذف می‌شود |
| `common/access.ts` | خواندن `createdById`/`members` برای کنترل دسترسی | دائمی (دسترسی عرضی است) |
| `modules/users/users.module.ts` | مدیریت `BusinessMember` توسط owner (docs/17) | موقت: با دروازهٔ نوشتنی حذف می‌شود |
| `**/*.spec.ts` | mock کلاینت | دائمی |

افزودن فایل تازه به این فهرست نیاز به توجیه در همین جدول دارد.

## ۶. قواعد برای کد تازه
- هر چیز تازه دربارهٔ کسب‌وکار که بیرون از `modules/businesses` لازم است: **یک متد خوانندهٔ مشخص** به `BusinessApi` اضافه کن، نه `include` عمومی. خروجی را کوچک و تایپ‌شده نگه دار.
- `BusinessApi` را تزریق کن (ماژول سراسری است؛ در تست `new BusinessApi(prisma)` با همان mock).
- نوشتن در جدول‌های هویت فقط در `modules/businesses` یا runnerهای استثنا.
- خروجی Docoo/Researcher بدون تغییر است: `buildDocooExport` و شکل خروجی همان قبل (فقط محل پرس‌وجو عوض شد).

## ۷. چه وقت واقعاً سرویس جدا شود
محرک‌ها: اپ سومی که روی کسب‌وکار **می‌نویسد**؛ تیم/مالک یا زمان انتشار جدا؛ نیاز به ایزوله‌سازی خرابی؛ الزام امنیتی/حجم جدا. مسیر: ۱) برنامهٔ جدا روی همان DB با schema جدا ۲) DB جدا ۳) انتقال runnerهای AI. هزینه‌هایی که باید حل شوند: کلید خارجی `Topic.businessId`، کنترل دسترسی (`BusinessMember`/`visibleBusinesses`)، صف/بودجه/ذخیرهٔ فایل، و تأخیر خواندن پروفایل در مسیر هر job.

## ۸. بدهی باقی‌مانده (به ترتیب سود)
1. دروازهٔ نوشتنی برای grantها (`users.module`) و حذف استثنای آن.
2. انتقال runnerهای AI کسب‌وکار به `modules/businesses` (مراقب وابستگی حلقه‌ای با `ai`).
3. جدا کردن فایل‌های `businesses.module.ts` (۱۱۰۰+ خط) به controller/service.
