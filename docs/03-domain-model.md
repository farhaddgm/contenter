# مدل دامنه و داده

منبع حقیقت: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)

## نمودار موجودیت‌ها

```
User ──< AuditLog
User ──< RefreshToken

Topic ──< Principle            (اصول اختصاصی موضوع؛ topicId=null یعنی اصل سراسری)
Topic ──< SampleContent ──1 SampleAnalysis
Topic ──< ContentProfile ──< ProfileTrait
Topic ──< IdeationRequest ──< Idea
Topic ──< Content ──< ContentVersion
Idea  ──< Content
ContentProfile ──< Content    (هر محتوا می‌داند از کدام نسخهٔ پروفایل ساخته شده)

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
| `status` | `DRAFT` (ساختهٔ AI، در انتظار بازبینی)، `APPROVED` یا `ARCHIVED` |
| `summary` | جمع‌بندی سبک |
| `styleGuide` | راهنمای سبک متنی که AI نوشته و ادمین ویرایش می‌کند |
| `sampleIds` | نمونه‌هایی که در ساخت این نسخه استفاده شده‌اند |

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

### IdeationRequest و Idea
- `IdeationRequest`: `count`، `direction`، `format` و `jobId`
- `Idea`: `title`، `angle`، `hook`، `format`، `outline[]`، `rationale`، `status` (`PROPOSED`، `SHORTLISTED`، `REJECTED` یا `USED`) و `score`

### Content و ContentVersion
- `Content`: `title`، `format`، `status` (`GENERATING`، `DRAFT`، `IN_REVIEW`، `APPROVED`، `REJECTED` یا `FAILED`)، `ideaId?`، `brief?`، `profileId?` و `currentVersionId`
- `ContentVersion`: `version`، `title`، `body` (Markdown)، `hashtags[]`، `cta`، `notes`، `selfCheck` (JSON: رعایت هر اصل، امتیاز و پیشنهاد)، `feedback` (بازخوردی که این نسخه در پاسخ به آن ساخته شده) و `jobId`

### AiJob
| فیلد | توضیح |
|---|---|
| `type` | `ANALYZE_SAMPLE`، `BUILD_PROFILE`، `IDEATE`، `GENERATE_CONTENT` یا `REVISE_CONTENT` |
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
