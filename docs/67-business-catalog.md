# کاتالوگ ساختاریافتهٔ محصولات و خدمات (docs/67)

> **وضعیت: طرح و بنچ‌مارک.** کدی ساخته نشده و منتظر تأیید مالک است. نمای کلی: [65-business-next-steps.md](65-business-next-steps.md).

هر محصول، خدمت یا طرح کسب‌وکار یک ردیف ساختاریافته دارد (نام و نام‌های دیگر، وضعیت، قیمت و اعتبار قیمت، ویژگی‌ها، اولویت). مدل آن را در بلوک `[CATALOG]` می‌خواند و **دروازهٔ کیفیت با کد** قیمت نوشته‌شده در متن را با قیمت ثبت‌شده می‌سنجد.

## ۱. مسئله و وضع فعلی

- بخش `SERVICES` متن آزاد Markdown است (`BUSINESS_SECTION_SPEC`: «فهرست با توضیح کوتاه، ویژگی و بازهٔ قیمت»). کد نمی‌تواند «قیمت محصول X» را از آن بخواند.
- `BusinessFact` یک جفت `label`/`value` است. برای ۲۰ محصول و چند ویژگی هر کدام، فهرست طولانی می‌شود و در سقف ۵٬۰۰۰ نویسهٔ `[FACTS]` جا نمی‌ماند (حداکثر ۱۵۰ واقعیت). رابطهٔ «این قیمت مال کدام محصول است» فقط در متن `label` است.
- گیت کیفیت، `FACT_NUMBER_MISMATCH` را وقتی می‌دهد که جمله «دربارهٔ واقعیت» باشد (`mentionsLabel`: دست‌کم ۷۵٪ واژه‌های `label` و حداقل دو واژه) و **هیچ عددی** از جمله با اعداد واقعیت نخواند. اگر `label` یک واژه باشد، هر جملهٔ دارای آن واژه «دربارهٔ واقعیت» می‌شود و اعداد غیرقیمتی (مثلاً «۳ ماه ضمانت») هشدار کاذب می‌دهند.
- `extractNumbers` فارسی را خوب می‌شناسد (ارقام فارسی/عربی، جداکنندهٔ هزار، «۵۰۰ هزار» ← `500` و `500000`) و می‌توان از آن استفاده کرد.
- ابهام ریال/تومان در متن‌های ایرانی رایج است و در داده‌ٔ فعلی جایی ندارد.
- محتوا به محصول وصل نیست؛ «کدام محصول مدتی است محتوا ندارد» پرسیدنی نیست.

## ۲. ایده‌پردازی: گزینه‌ها

| گزینه | مزیت | عیب |
| --- | --- | --- |
| الف) فقط `BusinessFact` را قوی‌تر کنیم (گروه‌بندی با `offerName`) | کم‌هزینه | هنوز فهرست تخت؛ بدون وضعیت/اولویت/فصل؛ سقف متن همان مشکل |
| ب) بخش `SERVICES` را به جدول Markdown الزام کنیم و با regex بخوانیم | بدون migration | شکننده؛ ادمین و AI فرمت را می‌شکنند |
| ج) **جدول `BusinessOffering`** + `[CATALOG]` + بررسی قیمت با کد | داده‌ٔ قابل‌پرسش، صادرات تمیز، بررسی دقیق | migration و رابط تازه |

**انتخاب: ج.** بخش `SERVICES` می‌ماند (روایت و توضیح)؛ کاتالوگ برای «اعداد و وضعیت» است. هیچ‌چیز حذف نمی‌شود و دو لایه با هم کار می‌کنند.

## ۳. بنچ‌مارک

| منبع | چه می‌دهد | درس |
| --- | --- | --- |
| [Google: Product/Offer](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing) | `price`، `priceCurrency`، `priceValidUntil` (تاریخ ISO 8601) | قیمت **بدون ارز و بدون تاریخ اعتبار** ناقص است؛ همان فیلدهای ما (`priceCurrency`، `priceValidUntil`). طبق منابع ثانویه، قیمت با تاریخ گذشته ممکن است نمایش داده نشود، مانند `isFactExpired` ما |
| [Typeface](https://www.typeface.ai/education/typeface-academy/getting-started-with-typeface) | کاتالوگ محصول برای تولید توضیح و تصویر، «زبان تأییدشده» برای انطباق | دادهٔ محصول ساختاریافته منبع تولید است (و در معرفی Arc Graph «اطلاعات ساختاریافتهٔ محصول» جزو لایهٔ زمینه است) |
| [Jasper Knowledge Base](https://www.jasper.ai/jasper-iq) | حقایق دربارهٔ محصول (مثل جنس پارچه یا محافظت UV) را هنگام نوشتن می‌کشد | واقعیت محصول باید در دسترس تولید باشد؛ ولی فرمت آن آزاد است و راستی‌سنجی عددی در صفحه‌های دیده‌شده نبود |
| Writer (گزارش‌های ثانویه) | نام محصول و زبان انطباق را درست نگه می‌دارد | بررسی بعد از تولید لازم است |

محدودیت: منابع Typeface/Jasper/Writer بازاریابی یا ثانویه‌اند؛ مکانیزم داخلی دیده نشد. **تمایز پیشنهادی ما:** بررسی قیمت با کد روی متن فارسی (ارقام، جداکننده، «هزار/میلیون»، تومان/ریال).

## ۴. طراحی

### ۴.۱ داده (Prisma + Zod در `packages/shared`)
```prisma
enum OfferingKind   { PRODUCT SERVICE PLAN BUNDLE }
enum OfferingStatus { ACTIVE SEASONAL PAUSED DISCONTINUED }

model BusinessOffering {
  id              String         @id @default(cuid())
  businessId      String
  name            String
  /// املاهای دیگر (فارسی/لاتین/مخفف) برای تطبیق در دروازهٔ کیفیت
  aliases         String[]
  kind            OfferingKind   @default(PRODUCT)
  status          OfferingStatus @default(ACTIVE)
  /// 0 = تبلیغ نشود · 1 = معمولی · 2 = اولویت · 3 = قهرمان (از GOALS)
  push            Int            @default(1)
  summary         String         @default("")   // تا ۴۰۰ نویسه
  features        String[]                       // تا ۸ مورد
  priceAmount     Decimal?       @db.Decimal(18, 2)
  /// IRT (تومان) | IRR (ریال) | USD | EUR ... — همیشه با قیمت می‌آید
  priceCurrency   String?
  priceFrom       Boolean        @default(false) // «از …»
  priceUnit       String         @default("")    // «ماهانه»، «هر جلسه»
  priceValidUntil DateTime?
  availableFrom   DateTime?
  availableUntil  DateTime?
  url             String         @default("")
  /// یادداشت داخلی؛ هرگز به مدل یا خروجی نمی‌رود
  note            String         @default("")
  source          SectionSource  @default(ADMIN)
  verified        Boolean        @default(true)
  isActive        Boolean        @default(true)
  sortOrder       Int            @default(0)
  updatedById     String?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@unique([businessId, name])
  @@index([businessId, status])
}
```
- حد: ‏`BUSINESS_OFFERING_LIMIT = 60`؛ نام تا ۱۲۰، `aliases` تا ۶ مورد.
- `Decimal` چون قیمت بعضی کالاها از سقف `Int` (حدود ۲٫۱ میلیارد) بیشتر است. در JSON به‌صورت رشته می‌رود و Zod عدد مثبت می‌پذیرد.
- **ارز اجباری است** و هیچ تبدیل بی‌صدایی نیست. نمایش با `Intl` (`fa-IR`) و واژهٔ «تومان/ریال» عیناً.
- ردیف‌های ساختهٔ AI با `source: 'AI'`، `verified: false`، `isActive: false` ذخیره می‌شوند و تا تأیید ادمین به مدل نمی‌روند.

### ۴.۲ بلوک `[CATALOG]`
داخل همان متغیر `business` (پس از `[FACTS]`)، **بدون متغیر پرامپت تازه و بدون تغییر قالب‌ها** (نگهبان eval)؛ بدون ردیف، بایت خروجی تغییر نمی‌کند.
```
### Offerings [CATALOG]
Items the business sells. Quote names and prices exactly. A price is valid only if shown here;
write around a missing price. Do not promote items marked NOT AVAILABLE.
- [PLAN · push 2] اشتراک طلایی — ۱۹۹٬۰۰۰ تومان / ماهانه (valid until 2026-11-30)
  Features: …; …
- [PRODUCT · NOT AVAILABLE] … 
```
ترتیب: `push` نزولی، سپس `sortOrder`. قیمت منقضی یا بدون ارز چاپ نمی‌شود و جایش «price not available» می‌آید. بودجه ‏۶٬۰۰۰ نویسه (ثابت `MAX_CATALOG_TEXT`) با همان الگوی `budgeted`. وضعیت `DISCONTINUED` فقط به‌صورت «NOT AVAILABLE» و بدون ویژگی‌ها.

### ۴.۳ دروازهٔ کیفیت (کد، فقط هشدار)
دو کد تازه به **انتهای** `QualityIssueCode`:
- `OFFERING_PRICE_MISMATCH`: جمله‌ای که نام یا یکی از `aliases` را دارد (با همان `mentionsLabel`) و **عدد قیمتی** دارد، ولی هیچ‌کدام از آن‌ها با قیمت ثبت‌شده نمی‌خواند. «عدد قیمتی» یعنی عددی که بلافاصله پیش از واژهٔ ارز (تومان/ریال/دلار/$/€) یا همراه «هزار/میلیون/میلیارد» + ارز بیاید؛ اعداد دیگر (ضمانت، تعداد، تاریخ) نادیده‌اند و هشدار کاذب نمی‌دهند. تبدیل ریال↔تومان (×۱۰) پذیرفته می‌شود به شرط ذکر واژهٔ ارز.
- `OFFERING_UNAVAILABLE`: نام آیتم `PAUSED`/`DISCONTINUED` یا خارج از بازهٔ فصلی در متن آمده.
هر دو `warn`اند و مانند همهٔ بررسی‌ها هرگز مرحلهٔ بازبینی یا انتشار را مسدود نمی‌کنند. `STALE_CODES` در `stale.ts` یک کد تازه (`OFFERING_PRICE_MISMATCH`) می‌گیرد تا محتوای تأییدشدهٔ دارای قیمت کهنه در «ردیاب محتوای کهنه» (docs/61) پیدا شود. ورودی تازهٔ `checkContentQuality`: `offerings?: QualityOfferingRule[]`.

### ۴.۴ استخراج با AI (اختیاری، برای راه‌اندازی اولیه)
کار `BUSINESS_OFFERINGS_EXTRACT` (پشت `AiJobsService.enqueue`؛ وزن آن در `AI_TASK_WEIGHT` هنگام ساخت تعیین شود) از `SERVICES`، facts و رفرنس‌های خواندنی فهرست آیتم‌ها را پیشنهاد می‌دهد. الگو مانند `resolveSuggestions` در یادگیری از ویرایش (docs/30): **کد** هر آیتم را می‌سنجد، **نه مدل**:
- هر آیتم باید `evidence` (نقل کوتاه از منبع) داشته باشد و آن نقل واقعاً در متن منبع باشد (تطبیق با `fold`)؛ وگرنه حذف.
- قیمت فقط اگر ارقامش (`extractNumbers`) در همان نقل باشد؛ وگرنه قیمت خالی می‌شود نه حدس.
- تکراری (نام/alias موجود) رد می‌شود؛ باقی `isActive: false` ذخیره و ادمین یکی‌یکی تأیید می‌کند.
مدل هیچ‌چیز را مستقیم در کاتالوگ فعال نمی‌نویسد.

### ۴.۵ API (همه `@BusinessScoped`)
| مسیر | کار |
| --- | --- |
| `GET /businesses/:id/offerings` | فهرست |
| `POST /businesses/:id/offerings` | افزودن |
| `PATCH` / `DELETE /business-offerings/:id` | ویرایش / حذف |
| `POST /business-offerings/:id/confirm` | تأیید ردیف AI (فعال می‌شود) |
| `POST /businesses/:id/offerings/extract` | شروع استخراج |
دسترسی نوشتن EDIT؛ لاگ ممیزی `business.offering_*` بدون افشای `note`.

### ۴.۶ مرز ماژول و خروجی‌ها
- جدول جزو «هویت کسب‌وکار» است (docs/63): خواندن بیرونی فقط با متدهای تازهٔ `BusinessApi` (`offeringsForPrompt`، `offeringsForQuality`) و افزودن `offerings` به `BUSINESS_PROMPT_INCLUDE`. اسم delegate (`businessOffering`) زیر قانون ESLint فعلی می‌افتد. `ContextLoader` و `ContentsService.detail` از همین متدها می‌خوانند.
- **Docoo / Bee Researcher** (docs/18، docs/26): آرایهٔ تازهٔ `offerings` فقط افزوده می‌شود، با ترتیب قطعی (`sortOrder`، نام، `id`)، بدون `note` و بدون هویت افراد؛ نسخهٔ `DOCOO_EXPORT_SCHEMA_VERSION` بالا نمی‌رود. این تغییر هش سند را عوض می‌کند (انتظار می‌رود: داده افزوده شده).

### ۴.۷ رابط
برگهٔ «محصولات و خدمات»: جدول (نام، نوع، وضعیت، قیمت با نشان قرمز اگر منقضی، اولویت، تأییدشده)، کشوی فرم، دکمهٔ «استخراج از پروفایل» با دیالوگ مرور شواهد. نمایش با Intl و RTL.

### ۴.۸ فاز دوم (جدا، پس از تجربه)
- `Idea.offeringId` و `Content.offeringId` (اختیاری؛ همان قاعدهٔ `pillarId`: باید متعلق به کسب‌وکار همان پروژه باشد، برچسب را آدم می‌زند نه مدل) و `offeringCoverage` (تابع خالص shared شبیه `buildCoverage`): کدام محصول در ۳۰/۶۰/۹۰ روز اخیر محتوای تأییدشده نداشته.
- واگذاری اولویت (`push`) به `GOALS` با پیشنهاد، بدون خودکارسازی.

## ۵. قاعده‌ها و قیدها
- AI تصمیم می‌گیرد، کد اجرا می‌کند: مدل فقط پیشنهاد استخراج می‌دهد؛ ذخیره/تأیید/بررسی قیمت با کد.
- بدون متغیر پرامپت تازه، بدون تغییر `prompts/defaults.ts`.
- بدون ادعای «بهترین/ارزان‌ترین» از داده؛ فقط عدد و ویژگی ثبت‌شده.
- تنظیمات و حدها ثابت‌های نام‌دار در shared؛ متن رابط از `i18n/fa.ts` و `en`.

## ۶. معیار پذیرش و تست
1. بدون کاتالوگ، خروجی `formatBusiness` بایت‌به‌بایت همان قبلی است.
2. قیمت منقضی، بدون ارز، یا آیتم غیرفعال/تأییدنشده در `[CATALOG]` نمی‌آید.
3. «اشتراک طلایی فقط ۱۹۹ هزار تومان» با قیمت ۱۹۹٬۰۰۰ تومان می‌خواند؛ «۱٬۹۹۰٬۰۰۰ ریال» هم؛ «۲۹۹ هزار تومان» ← `OFFERING_PRICE_MISMATCH`؛ «۳ ماه ضمانت» ← هشدار ندارد.
4. استخراج: آیتم بدون شاهد یا با قیمتی که در شاهد نیست ذخیره/پر نمی‌شود.
5. نام تکراری ۴۰۹؛ بیش از ۶۰ مورد ۴۰۰؛ کاربر بدون EDIT ۴۰۳.
6. خروجی Docoo با دو بار فراخوانی یکسان (جز `exportedAt`) و بدون `note`.

## ۷. ریسک‌ها و سؤال‌های باز
- تطبیق نام با `mentionsLabel` برای نام‌های یک‌واژه‌ای ممکن است جملهٔ بی‌ربط را بگیرد؛ به همین دلیل مقایسه فقط روی «عدد قیمتی» است و هشدار فقط نمایش‌دادنی.
- قیمت‌های ایرانی اغلب بازه‌ای یا «توافقی» است: `priceFrom` و قیمت خالی پوشش می‌دهند؛ پیش‌فرض خالی = «قیمت نگو».
- **سؤال برای مالک:** کسب‌وکار اصلی چند محصول/خدمت دارد و قیمتشان چقدر تغییر می‌کند؟ اگر کمتر از ۱۰ مورد و تقریباً ثابت باشد، ارزش این قابلیت پایین‌تر می‌آید.

## ۸. تلاش و ترتیب ساخت
M. ترتیب: مدل + Zod + CRUD ← `[CATALOG]` ← بررسی قیمت ← رابط ← صادرات Docoo ← استخراج AI. بهتر است بعد از [66](66-business-context-preview.md) ساخته شود تا اندازهٔ بلوک تازه دیده شود.
