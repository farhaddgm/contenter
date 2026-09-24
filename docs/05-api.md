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
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`، همهٔ نشست‌ها باطل می‌شوند |

## موضوع‌ها و اصول
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/topics?page&pageSize&q&status` | فهرست صفحه‌بندی‌شده با شمارنده‌ها |
| POST | `/topics` | ایجاد |
| GET / PATCH | `/topics/:id` | مشاهده / ویرایش (از جمله `status`) |
| DELETE | `/topics/:id` | حذف (فقط ADMIN) |
| GET / POST | `/topics/:id/principles` | اصول موضوع |
| GET / POST | `/principles/global` | اصول سراسری (ایجاد فقط توسط ADMIN) |
| PATCH / DELETE | `/principles/:id` | ویرایش / حذف (اصول سراسری فقط توسط ADMIN) |

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
| POST | `/topics/:id/profiles/build` | **۲۰۲** — `{ sampleIds? }` ← کار `BUILD_PROFILE` |
| GET / PATCH | `/profiles/:id` | مشاهده همراه مشخصه‌ها / ویرایش `summary` و `styleGuide` |
| POST | `/profiles/:id/approve` | تأیید و فعال‌سازی. مشخصه‌های پیشنهادی هم تأیید می‌شوند و نسخهٔ تأییدشدهٔ قبلی بایگانی می‌شود. |
| POST | `/profiles/:id/archive` | بایگانی |
| POST | `/profiles/:id/traits` | افزودن مشخصهٔ دستی |
| PATCH / DELETE | `/traits/:id` | تأیید، رد، ویرایش یا حذف مشخصه |

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
