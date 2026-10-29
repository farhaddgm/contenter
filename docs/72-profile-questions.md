# سؤال‌های تکمیل پروفایل (docs/72)

> **وضعیت: ساخته شده.** کد: `packages/shared/src/profile-questions.ts`، `ProfileQuestionsService` / `ProfileQuestionsController` در `modules/businesses`، `profile-questions-card.tsx` در وب. نمای کلی نقشهٔ راه: [65-business-next-steps.md](65-business-next-steps.md).

## ۱. مسئله

امتیاز سلامت پروفایل (docs/16) می‌گوید چه چیزی کم است، ولی ادمین باید خودش بفهمد دقیقاً چه بنویسد. این قابلیت «جای خالی» را به **سؤال کوتاه** تبدیل می‌کند؛ پاسخ مستقیم به همان بخش اضافه می‌شود.

## ۲. طراحی

- **سؤال‌ها را کد می‌سازد، نه مدل** (`buildProfileQuestions`، تابع خالص و قطعی). قاعده‌ها:
  - بخش خالی ← `SECTION_EMPTY:<key>`؛ بخش کوتاه‌تر از `minChars` (از `BUSINESS_SECTION_META`) ← `SECTION_THIN:<key>`.
  - بخشی که AI نوشته و تأیید نشده ← `SECTION_UNREVIEWED:<key>`؛ بخشی که بیش از ۱۸۰ روز تغییر نکرده ← `SECTION_STALE:<key>`. (هر دو فقط به بخش می‌برند.)
  - بدون رقیب فعال ← `NO_COMPETITORS` (و تا آن زمان سؤال خالی بودن بخش «رقبا» نمی‌آید)؛ بدون واقعیت کلیدی ← `NO_FACTS`؛ بدون محصول ← `NO_OFFERINGS`؛ محصول بدون مزیت ← `OFFERINGS_NO_CLAIMS`؛ مزیت بدون مدرک ← `CLAIMS_UNPROVEN`؛ فصل اوج محصولی از ماه آینده ← `PEAK_SOON`.
- ترتیب: وزن بخش (`weight` × ۱۰۰) و سپس نوع سؤال؛ حداکثر ۱۲ سؤال در پاسخ، `total` تعداد کل را می‌دهد.
- **پاسخ دادن:** فقط سؤال‌های `SECTION_EMPTY` و `SECTION_THIN` در همان کارت پاسخ می‌گیرند. متن ادمین با یک خط خالی به انتهای بخش اضافه می‌شود و از `writeSection` (با `actor` کاربر و قفل بخش، docs/69) می‌گذرد؛ پس بخش «فقط ادمین» برای ویراستار ۴۰۳ می‌دهد و سؤال‌هایش اصلاً به او نشان داده نمی‌شود. بقیهٔ سؤال‌ها دکمهٔ «برو به …» دارند (گزینهٔ `GOTO_*`).
- **ردکردن:** `BusinessQuestionSkip` (`businessId` + `code`، یکتا). سؤال ردشده تا «نمایش سؤال‌های ردشده» (`DELETE …/questions/skips`) برنمی‌گردد.
- متن پاسخ در `AuditLog` نمی‌آید (فقط `code`).

## ۳. API

همه `@BusinessScoped('business')`؛ خواندن VIEW، بقیه EDIT.

| مسیر | کار |
| --- | --- |
| `GET /businesses/:id/questions` | `{ questions, total, skipped }` |
| `POST /businesses/:id/questions/answer` | `{ code, answer ≤ 4000 }` ← به بخش اضافه می‌شود، فهرست تازه برمی‌گردد؛ سؤال غیربخشی ← ۴۰۰ |
| `POST /businesses/:id/questions/skip` | `{ code }` |
| `DELETE /businesses/:id/questions/skips` | بازگرداندن سؤال‌های ردشده |

## ۴. مرزها

- مدل در هیچ مرحله‌ای دخالت ندارد؛ هزینهٔ AI صفر است.
- سؤال‌ها اطلاعات تازه نمی‌سازند؛ فقط از داده‌های ذخیره‌شده (بخش‌ها، واقعیت‌ها، رقبا، کاتالوگ) شمرده می‌شوند.
- متن پاسخ ادمین «تأییدشده» حساب می‌شود (`source: ADMIN`).

## ۵. تست

`profile-questions.spec.ts` (shared: قاعده‌ها، ترتیب، رد کردن، بخش قفل‌شده، سقف ۱۲، `answerableSection`) و `profile-questions.spec.ts` (API: شمارش مزیت‌ها از JSON، افزودن پاسخ، عدم ثبت متن در ممیزی، قفل، ردکردن و بازگرداندن).

## ۶. ساخته نشد

- سؤال‌هایی که مدل از متن موجود بسازد (مثلاً «در بخش X تناقض هست»)؛ فقط اگر مالک بخواهد و با همان قاعدهٔ «کد اعتبارسنجی می‌کند».
- پاسخ‌دادن به سؤال‌های غیربخشی در همان کارت (مثلاً ساخت رقیب از کارت).

> **افزوده (docs/73 فاز ۳):** سه سؤال تازه دربارهٔ مخاطب‌ها: `NO_SEGMENTS`، `OFFERINGS_NO_AUDIENCE`، `SEGMENTS_NO_OFFERING` و کنش `GOTO_AUDIENCES`. با کد پیدا می‌شوند و مثل بقیه قابل ردکردن‌اند.
