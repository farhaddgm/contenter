# مدل دامنه و داده

منبع حقیقت: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)

## نمودار موجودیت‌ها

```
User ──< AuditLog
User ──< RefreshToken

Business ──< Topic             (کسب‌وکاری که پروژه برایش محتوا تولید می‌کند؛ اختیاری)
Business ──< BusinessSection ──< BusinessSectionRevision
Business ──< BusinessSuggestion
BusinessDiscovery ──? Business (تحقیق کلیدواژه و کسب‌وکار ساخته‌شده از آن)

Topic ──< Principle            (اصول اختصاصی موضوع؛ topicId=null یعنی اصل سراسری)
Topic ──< SampleContent ──1 SampleAnalysis
Topic ──< ContentProfile ──< ProfileTrait
Topic ──< BrandDocument      (برندبوک / راهنمای نگارش موضوع؛ متن ساده)
Topic ──< IdeationRequest ──< Idea
Topic ──< Content ──< ContentVersion
Idea  ──< Content
ContentProfile ──< Content    (هر محتوا می‌داند از کدام نسخهٔ پروفایل ساخته شده)
Topic ──< Tag >──< Idea / Content   (چندبه‌چند؛ [20-tags-campaigns.md](20-tags-campaigns.md))
Topic ──< Campaign ──< Content      (هر محتوا حداکثر در یک کمپین)
Content ──< ContentReview           (تاریخچهٔ بازبینی)  ·  Content ──< ContentComment  ([21-review-workflow.md](21-review-workflow.md))

AiJob         (هر فراخوانی AI؛ targetType/targetId به موجودیت مرتبط اشاره می‌کند)
PromptTemplate (key + version؛ فقط یک نسخهٔ فعال برای هر key)
SystemSetting  (key/value JSON)
```

## موجودیت‌ها

### User (کاربر)
| فیلد | توضیح |
|---|---|
| `email`، `name`، `role` | نقش: `ADMIN`، `EDITOR` یا `VIEWER` |
| `passwordHash` | argon2id. برای حساب‌های «فقط جیمیل» خالی (null) است |
| `loginMethod` | `PASSWORD` (پیش‌فرض)، `GOOGLE` (فقط جیمیل) یا `BOTH`. فقط مالک می‌تواند `GOOGLE` و `BOTH` را تعیین کند |
| `googleSub` | شناسهٔ حساب گوگل که در اولین ورود با گوگل ثبت می‌شود (یکتا) |
| `isActive`، `lastLoginAt` | وضعیت و زمان آخرین ورود |

مالک برنامه کاربری است که ایمیلش با `OWNER_EMAIL` یکی باشد ([11-google-login.md](11-google-login.md)).

### Topic (موضوع)
| فیلد | توضیح |
|---|---|
| `title`، `description` | عنوان و شرح کامل موضوع |
| `audience` | مخاطب هدف |
| `platform` | پلتفرم هدف: `INSTAGRAM`، `YOUTUBE`، `TELEGRAM`، `LINKEDIN`، `X`، `BLOG`، `OTHER` |
| `language` | زبان تولید (پیش‌فرض `fa`) |
| `status` | `ACTIVE` یا `ARCHIVED` |
| `activeProfileId` | پروفایل تأییدشدهٔ فعلی که برای ایده‌پردازی و تولید استفاده می‌شود |
| `businessId` | کسب‌وکار متصل (اختیاری)؛ پروفایلش به همهٔ کارهای AI موضوع داده می‌شود |
| `samplesSkippedAt` | زمانی که ادمین مرحلهٔ نمونه‌محتوا را رد کرده است (`null` = رد نشده)؛ محتوا آن‌وقت بر اساس اسناد تولید می‌شود ([19-optional-samples.md](19-optional-samples.md)) |

### Business و موجودیت‌های وابسته (کسب‌وکار)
کسب‌وکار با مشخصات پایه (نام، شعار، حوزه، وب‌سایت، موقعیت، زبان) و ۱۵ بخش پروفایل (`BusinessSection`: معرفی، خدمات، بازار هدف، پرسونا، ارزش پیشنهادی، رقبا، لحن برند، برندبوک، پیام‌های کلیدی، ستون‌های محتوایی، قواعد، کانال‌ها، اهداف، پرسش‌های مشتری، تقویم مناسبت‌ها؛ هرکدام با وضعیت تأیید). واقعیت‌های کلیدی در `BusinessFact`، واژه‌نامهٔ برند در `BusinessTerm` و بررسی‌های کیفیت AI در `BusinessAudit` هستند ([16-business-profile-quality.md](16-business-profile-quality.md)). هر جایگزینی متن بخش در `BusinessSectionRevision` تاریخچه می‌سازد؛ پیشنهادهای AI در `BusinessSuggestion` تا تأیید ادمین منتظر می‌مانند؛ تحقیق کلیدواژه در `BusinessDiscovery` ثبت می‌شود. منابع تحقیقِ مسدودشده (صفحه یا کل سایت) در `BlockedSource` نگه داشته می‌شوند و در هیچ تحقیقی استفاده نمی‌شوند. منابعی که ادمین خودش به AI می‌دهد (لینک، سند گوگل، متن، حساب اینستاگرام، سایت چندصفحه‌ای؛ برای دو مورد آخر گزارش آماریِ محاسبه‌شده با کد در `analysis` هم هست — [28-instagram-website-profile.md](28-instagram-website-profile.md)) در `BusinessReference` با نسخهٔ متنی ذخیره‌شده‌اند و حساب‌های گوگلِ متصل برای خواندن اسناد خصوصی در `GoogleDriveAccount` ([14-business-references.md](14-business-references.md)). توضیح‌های ادمین که AI پروفایل را بر اساسشان بازبینی می‌کند در `BusinessNote` و محتواهای قبلی کسب‌وکار (مقاله، تصویر، بنر، ویدئو …) با تحلیل AI در `BusinessAsset` هستند ([15-business-notes-and-assets.md](15-business-notes-and-assets.md)). جزئیات کامل: [12-businesses.md](12-businesses.md).

### Principle (اصل)
| فیلد | توضیح |
|---|---|
| `kind` | `MUST` (باید)، `AVOID` (نباید) یا `PREFER` (ترجیح) |
| `text` | متن اصل |
| `topicId` | `null` یعنی اصل سراسری که به همهٔ موضوع‌ها اعمال می‌شود |
| `isActive`، `order` | فعال یا غیرفعال بودن، و ترتیب |

### SampleContent (نمونه محتوا)
| فیلد | توضیح |
|---|---|
| `url` | لینک رسانه |
| `mediaType` | `ARTICLE`، `VIDEO`، `IMAGE`، `POST`، `AUDIO` یا `UNKNOWN` (تشخیص با کد) |
| `platform` | تشخیص از دامنه |
| `manualText` | متن، کپشن یا زیرنویس که ادمین دستی وارد می‌کند (اختیاری، ولی دقت را بالا می‌برد) |
| `adminNote` | توضیح ادمین دربارهٔ اینکه چرا این نمونه خوب است |
| `fetchStatus` | `PENDING`، `FETCHED`، `FAILED` یا `SKIPPED` |
| `fetched` | JSON: `title`، `description`، `siteName`، `text`، `images[]`، `author`، `publishedAt`، `embed` |
| `analysisStatus` | `NONE`، `QUEUED`، `DONE` یا `FAILED` |

### SampleAnalysis (تحلیل نمونه)
خروجی AI برای یک نمونه: `summary` و `result` (JSON طبق اسکیمای `SampleAnalysisResult`) که شامل موارد زیر است:
- `tone`، `voice`، `audience`، `structure`، `hook`، `length`، `formatting`، `cta`، `visualStyle`، `languageNotes`
- `traits[]`: هر مشخصه `category`، `name`، `description` و `evidence` دارد.

### ContentProfile (پروفایل محتوایی، نسخه‌دار)
| فیلد | توضیح |
|---|---|
| `version` | شمارهٔ نسخه در موضوع |
| `status` | `DRAFT` (پیش‌نویس و قابل ویرایش)، `APPROVED` یا `ARCHIVED` (قفل؛ برای تغییر باید نسخهٔ جدیدی از روی آن ساخت) |
| `summary` | جمع‌بندی سبک |
| `styleGuide` | راهنمای سبک متنی که AI نوشته و ادمین ویرایش می‌کند |
| `sampleIds` | نمونه‌هایی که در ساخت این نسخه استفاده شده‌اند |
| `brandDocIds` | اسناد برندی که هنگام ساخت با AI در context بوده‌اند |
| `jobId` | کار `BUILD_PROFILE` سازنده؛ برای نسخه‌های دستی و کپی `null` است |
| `basedOnVersion` | اگر نسخه با «نسخهٔ جدید از روی این نسخه» ساخته شده باشد، شمارهٔ نسخهٔ مبدأ |

سه راه ساخت نسخه: **ساخت با AI** (از نمونه‌های تحلیل‌شده و/یا اسناد برند فعال)، **ایجاد دستی** (بدون AI؛ مشخصه‌های ادمین با وضعیت `APPROVED` و اطمینان ۱) و **کپی از نسخهٔ دیگر** (مشخصه‌های ردشده کپی نمی‌شوند). همهٔ نسخه‌های جدید `DRAFT` هستند؛ فقط `DRAFT` قابل ویرایش است (خلاصه، راهنما، افزودن/ویرایش/حذف و تأیید/رد مشخصه) و سرور ویرایش نسخهٔ قفل را با ۴۰۹ رد می‌کند.

### ProfileTrait (مشخصهٔ پروفایل)
| فیلد | توضیح |
|---|---|
| `category` | `TONE`، `STRUCTURE`، `HOOK`، `LANGUAGE`، `FORMAT`، `VISUAL`، `CTA`، `AUDIENCE` یا `OTHER` |
| `name`، `description` | نام و توضیح مشخصه |
| `confidence` | اطمینان AI از 0 تا 1 |
| `evidence` | شواهد از نمونه‌ها |
| `status` | `PROPOSED`، `APPROVED` یا `REJECTED` |
| `source` | `AI` یا `ADMIN` (ادمین می‌تواند مشخصهٔ دستی اضافه کند) |

فقط مشخصه‌های `APPROVED` از پروفایل `APPROVED` فعال در تولید استفاده می‌شوند.

### BrandDocument (سند برند)
| فیلد | توضیح |
|---|---|
| `kind` | `BRAND_BOOK`، `WRITING_GUIDE` یا `OTHER` |
| `title`، `content` | عنوان و متن سند (حداکثر ۱۰۰٬۰۰۰ نویسه) |
| `fileName` | نام فایل متنی بارگذاری‌شده (اختیاری) |
| `isActive` | فقط اسناد فعال به AI داده می‌شوند |

اسناد فعال با تگ `<brand_guidelines>` به `BUILD_PROFILE`، `IDEATE`، `GENERATE_CONTENT` و `REVISE_CONTENT` داده می‌شوند (مجموعاً حداکثر ۴۰٬۰۰۰ نویسه در هر درخواست؛ اسناد بعدی کوتاه می‌شوند). فعلاً فقط سطح موضوع وجود دارد و سند سراسری نداریم.

### IdeationRequest و Idea
- `IdeationRequest`: `count`، `direction`، `format` و `jobId`
- `Idea`: `title`، `angle`، `hook`، `format`، `outline[]`، `rationale`، `status` (`PROPOSED`، `SHORTLISTED`، `REJECTED` یا `USED`) و `score`

### Content و ContentVersion
- `Content`: `title`، `format`، `status` (`GENERATING`، `DRAFT`، `IN_REVIEW`، `APPROVED`، `REJECTED` یا `FAILED`)، `ideaId?`، `brief?`، `profileId?`، `campaignId?`، `platform?` و `sourceContentId?` (نسخهٔ پلتفرم دیگر؛ [23-repurposing.md](23-repurposing.md))، `reviewStage?` (فقط در `IN_REVIEW`: `EDITORIAL` یا `FINAL`)، `scheduledAt?`، `publishedAt?`، `publishedUrl?` ([22-calendar-publishing.md](22-calendar-publishing.md)) و `currentVersionId`. وضعیت فقط با گام‌های گردش تأیید عوض می‌شود
- `ContentVersion`: `version`، `title`، `body` (Markdown)، `hashtags[]`، `cta`، `notes`، `selfCheck` (JSON: رعایت هر اصل، امتیاز و پیشنهاد)، `feedback` (بازخوردی که این نسخه در پاسخ به آن ساخته شده) و `jobId`

### AiJob
| فیلد | توضیح |
|---|---|
| `type` | `ANALYZE_SAMPLE`، `BUILD_PROFILE`، `IDEATE`، `GENERATE_CONTENT`، `REVISE_CONTENT`، `REPURPOSE_CONTENT` یا کارهای اسمارت و کسب‌وکار |
| `status` | `QUEUED`، `RUNNING`، `SUCCEEDED`، `FAILED` یا `CANCELED` |
| `targetType`، `targetId` | موجودیت هدف |
| `input`، `output` | JSON |
| `error`، `attempts` | خطا و تعداد تلاش |
| `model`، `inputTokens`، `outputTokens`، `cacheReadTokens`، `costUsd` | ثبت مصرف |
| `promptKey`، `promptVersion` | پرامپتی که استفاده شده |
| `startedAt`، `finishedAt`، `createdById` | زمان‌ها و ایجادکننده |

### PromptTemplate
`key` (مثلاً `analyze_sample`)، `version`، `system`، `user` (قالب با متغیرهای `{{var}}`)، `isActive` و `notes`. در seed نسخهٔ ۱ هر پرامپت ساخته می‌شود.

### موجودیت‌های اسمارت
- `InteractionLog`: تعاملات ثبت‌شده، وقتی جمع‌آوری کامل روشن باشد. فیلدها: `source` (سرور یا مرورگر)، `type`، `method`/`path`/`statusCode`/`durationMs`، `route`، `target` و `meta` پاک‌سازی‌شده.
- `AppError`: خطای گروه‌بندی‌شده با `fingerprint`، `source` (`SERVER`، `CLIENT` یا `AI_JOB`)، `category`، `hint`، `detail` (stack)، `count`، `status` (`NEW`، `SEEN`، `RESOLVED` یا `IGNORED`) و `firstSeenAt`/`lastSeenAt`.
- `SmartConversation` و `SmartMessage`: گفتگوی ادمین با اسمارت. `kind` یکی از `WALKER` یا `ERROR` است. پیام‌ها `PENDING`، `DONE` یا `FAILED` هستند و به `jobId` کار AI وصل‌اند.
- `WalkerIssue`: دفتر خطاهای واکر. متن عین پیام AI، `source`، `status` (`OPEN`، `IN_PROGRESS`، `RESOLVED` یا `WONT_FIX`)، کانتکست و یادداشت رفع را نگه می‌دارد.

### SystemSetting
کلید و مقدار JSON. نمونه‌ها:
- `ai.models`: مدل هر نوع کار، مثلاً `{ "default": "claude-opus-5" }`
- `ai.effort`: سطح effort هر نوع کار
- `ai.maxSamplesPerProfile`
- `smart`: `{ detailedLogging: false, retentionDays: 30 }`
