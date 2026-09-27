# مرجع API

- پایه: `/api`
- قالب: JSON. خطاها همیشه به این شکل برمی‌گردند: `{ statusCode, message, errors?: [{ path, message }] }`
- احراز هویت: هدر `Authorization: Bearer <accessToken>`. توکن تازه‌سازی در کوکی httpOnly به نام `contenter_rt` (مسیر `/api/auth`) قرار دارد.
- اعتبارسنجی: همهٔ بدنه‌ها و کوئری‌ها با اسکیماهای Zod در [`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts) بررسی می‌شوند.
- سیاست نقش‌ها: `VIEWER` فقط `GET` دارد. `EDITOR` می‌تواند محتوا را تغییر دهد. مسیرهای `/admin/*` فقط برای `ADMIN` است.
- کارهای AI پاسخ `202` همراه `{ jobId }` برمی‌گردانند و وضعیتشان با `GET /jobs/:id` پیگیری می‌شود.

## احراز هویت
| متد | مسیر | توضیح |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` ← `{ accessToken, user }` + کوکی refresh (سقف ۱۰ درخواست در دقیقه) |
| POST | `/auth/refresh` | چرخش توکن refresh ← `{ accessToken, user }` |
| POST | `/auth/logout` | ابطال refresh |
| GET | `/auth/me` | کاربر جاری |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`، همهٔ نشست‌ها باطل می‌شوند. برای حساب «فقط جیمیل» خطای 400 می‌دهد |
| GET | `/auth/providers` | `{ google }`: آیا ورود با گوگل پیکربندی شده است |
| GET | `/auth/google`، `/auth/google/callback` | ورود با گوگل (ناوبری کامل صفحه). جزئیات در [11-google-login.md](11-google-login.md) |
| GET / POST / PATCH / DELETE | `/owner/google-access[/:id]` | فهرست جیمیل‌های مجاز. **فقط مالک** (`OWNER_EMAIL`) |

خطای ورود با رمز برای حساب «فقط جیمیل» همان پیام عمومی «ایمیل یا رمز نادرست» است. کاربر (`user`) این فیلدها را هم دارد: `loginMethod`، `hasPassword` و `isOwner`.

## موضوع‌ها و اصول
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/topics?page&pageSize&q&status&businessId` | فهرست صفحه‌بندی‌شده با شمارنده‌ها و `business` |
| POST | `/topics` | ایجاد (`businessId` اختیاری؛ `null` = بدون کسب‌وکار) |
| GET / PATCH | `/topics/:id` | مشاهده / ویرایش (از جمله `status`) |
| DELETE | `/topics/:id` | حذف (فقط ADMIN) |
| GET / POST | `/topics/:id/principles` | اصول موضوع |
| GET / POST | `/principles/global` | اصول سراسری (ایجاد فقط توسط ADMIN) |
| PATCH / DELETE | `/principles/:id` | ویرایش / حذف (اصول سراسری فقط توسط ADMIN) |

## کسب‌وکارها
| متد | مسیر | توضیح |
|---|---|---|
| GET / POST | `/businesses` | فهرست / ایجاد دستی |
| GET | `/businesses/options` | فهرست سبک برای انتخاب |
| GET / PATCH / DELETE | `/businesses/:id` | پروفایل کامل / ویرایش / حذف (فقط ADMIN) |
| PUT | `/businesses/:id/sections/:key` | نوشتن یک بخش پروفایل |
| GET | `/businesses/:id/sections/:key/revisions`، POST `/business-revisions/:id/restore` | تاریخچه و بازگردانی |
| GET | `/businesses/:id/suggestions` | پیشنهادهای AI در انتظار |
| POST | `/businesses/:id/suggest`، `/businesses/:id/build` | کار `BUSINESS_SUGGEST` / `BUSINESS_BUILD` ← `{ jobId }` |
| POST | `/business-suggestions/:id/accept`، `/business-suggestions/:id/dismiss` | پذیرش (با ویرایش اختیاری) / رد |
| GET / POST | `/business-discoveries`، GET `/business-discoveries/:id` | تحقیق کلیدواژه (`BUSINESS_DISCOVER`) |
| POST | `/business-discoveries/:id/select` | `{ index }` — تأیید کاندیدا، ساخت کسب‌وکار و شروع `BUSINESS_BUILD` |

جزئیات بدنه‌ها و پاسخ‌ها: [12-businesses.md](12-businesses.md).

## نمونه‌ها
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/topics/:id/samples` | همراه با تحلیل |
| POST | `/topics/:id/samples` | `{ url, manualText?, adminNote?, autoAnalyze? }`. لینک همان لحظه با کد دریافت می‌شود و در صورت درخواست، تحلیل در صف قرار می‌گیرد. |
| PATCH | `/samples/:id` | ویرایش متن دستی و یادداشت |
| POST | `/samples/:id/refetch` | دریافت مجدد لینک |
| POST | `/samples/:id/analyze` | **۲۰۲** — کار `ANALYZE_SAMPLE` |
| DELETE | `/samples/:id` | حذف |

## پروفایل‌ها و مشخصه‌ها
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/topics/:id/profiles` | نسخه‌ها (`isActive`) |
| POST | `/topics/:id/profiles/build` | **۲۰۲** — `{ sampleIds? }` ← کار `BUILD_PROFILE`. به حداقل یک نمونهٔ تحلیل‌شده **یا** یک سند برند فعال نیاز دارد. |
| POST | `/topics/:id/profiles` | ایجاد دستی نسخهٔ `DRAFT` بدون AI — `{ summary?, styleGuide?, traits?[] }` |
| POST | `/profiles/:id/duplicate` | «نسخهٔ جدید از روی این نسخه»: کپی به یک `DRAFT` جدید (با `basedOnVersion`) |
| GET / PATCH | `/profiles/:id` | مشاهده همراه مشخصه‌ها / ویرایش `summary` و `styleGuide` (فقط `DRAFT`، وگرنه ۴۰۹) |
| POST | `/profiles/:id/approve` | تأیید و فعال‌سازی. مشخصه‌های پیشنهادی هم تأیید می‌شوند و نسخهٔ تأییدشدهٔ قبلی بایگانی می‌شود. |
| POST | `/profiles/:id/archive` | بایگانی |
| POST | `/profiles/:id/traits` | افزودن مشخصهٔ دستی (فقط `DRAFT`) |
| PATCH / DELETE | `/traits/:id` | تأیید، رد، ویرایش (`category`، `name`، `description`، `evidence`) یا حذف مشخصه (فقط در نسخهٔ `DRAFT`) |

## اسناد برند
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/topics/:id/brand-docs` | فهرست بدون متن (با `chars`) |
| POST | `/topics/:id/brand-docs` | `{ kind, title, content, fileName?, isActive? }` |
| GET / PATCH / DELETE | `/brand-docs/:id` | مشاهده با متن کامل / ویرایش / حذف |
| GET | `/topics/:id/ai-context` | خلاصهٔ ورودی‌های AI موضوع: نمونه‌های تحلیل‌شده، تعداد اصول، اسناد برند فعال، پروفایل فعال |

## ایده‌ها
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/topics/:id/ideas?status&page&q` | فهرست |
| POST | `/topics/:id/ideas/generate` | **۲۰۲** — `{ count, direction?, format? }` ← کار `IDEATE` |
| PATCH / DELETE | `/ideas/:id` | تغییر وضعیت، ویرایش یا حذف |

## محتوا
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/contents?topicId&status&q&page` | فهرست |
| POST | `/topics/:id/contents/generate` | **۲۰۲** — `{ ideaId? , brief?, format? }` ← `{ jobId, contentId }` |
| GET | `/contents/:id` | همراه نسخهٔ فعلی و تاریخچه |
| PATCH | `/contents/:id` | `{ status?: DRAFT, IN_REVIEW, APPROVED یا REJECTED, title? }` |
| POST | `/contents/:id/revise` | **۲۰۲** — `{ feedback }` ← کار `REVISE_CONTENT` |
| PUT | `/contents/:id/current` | ویرایش دستی که نسخهٔ جدیدی با منبع `ADMIN` می‌سازد |
| POST | `/contents/:id/versions/:versionId/restore` | بازگرداندن یک نسخه |
| DELETE | `/contents/:id` | حذف |

## کارها و داشبورد
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/jobs/:id` | وضعیت یک کار (برای poll) |
| GET | `/dashboard` | آمار |
| GET | `/health` | سلامت DB و Redis (عمومی) |

## اسمارت
مرجع کامل endpointهای `/smart/*` در [10-smart.md](10-smart.md#api) آمده است. پاسخ‌های 5xx یک فیلد `errorId` دارند که به رکورد خطایاب اشاره می‌کند.

## بک‌آفیس (`ADMIN`)
| متد | مسیر | توضیح |
|---|---|---|
| GET / POST / PATCH | `/admin/users[/:id]` | مدیریت کاربران |
| GET | `/admin/jobs?status&type&topicId&q&page` | فهرست کارهای AI |
| GET | `/admin/jobs/queue` | آمار صف |
| POST | `/admin/jobs/:id/retry` ، `/admin/jobs/:id/cancel` | اجرای مجدد / لغو |
| GET | `/admin/prompts` | کلیدها و نسخهٔ فعال هرکدام |
| GET / POST | `/admin/prompts/:key/versions` | نسخه‌ها / ایجاد نسخهٔ جدید |
| PUT | `/admin/prompts/:key/versions/:v/activate` | فعال‌سازی |
| GET / PUT | `/admin/settings/ai` | مدل، effort و سقف نمونه |
| GET | `/admin/audit-logs?q&entityType&page` | لاگ ممیزی |
