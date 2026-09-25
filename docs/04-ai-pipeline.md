# خط لولهٔ هوش مصنوعی

## مرز AI و کد

| مرحله | انجام‌دهنده | توضیح |
|---|---|---|
| دریافت لینک، تشخیص پلتفرم و نوع رسانه، استخراج متن و متادیتا | **کد** (`MediaFetcherService`) | Open Graph، oEmbed یوتیوب، استخراج متن اصلی HTML |
| تحلیل هر نمونه | **AI** (`ANALYZE_SAMPLE`) | خروجی: `SampleAnalysisResult` |
| جمع‌بندی و ساخت پروفایل | **AI** (`BUILD_PROFILE`) | خروجی: `ProfileBuildResult` ← کد نسخهٔ جدید و مشخصه‌ها را می‌سازد |
| تأیید یا رد مشخصه‌ها و تأیید پروفایل | **انسان** (ادمین) | |
| ایده‌پردازی | **AI** (`IDEATE`) | خروجی: `IdeationResult` ← کد ایده‌ها را ذخیره می‌کند |
| تولید محتوا | **AI** (`GENERATE_CONTENT`) | خروجی: `ContentDraftResult` + `selfCheck` |
| بازنویسی با بازخورد | **AI** (`REVISE_CONTENT`) | نسخهٔ جدید `ContentVersion` |
| پاسخ دستیار اسمارت | **AI** (`SMART_CHAT`) | فقط پاسخ متنی بر اساس کانتکست فقط‌خواندنی که کد می‌سازد ([10-smart.md](10-smart.md)) |
| صف‌بندی، retry، ذخیره، هزینه، دسترسی و نسخه‌بندی | **کد** | |

## مدل و تنظیمات

- ارائه‌دهندهٔ پیش‌فرض: **Anthropic Claude**، مدل `claude-opus-5`. از طریق `SystemSetting` یا env برای هر نوع کار قابل تغییر است.
- **Adaptive thinking** و **effort** قابل‌تنظیم برای هر کار. پیش‌فرض‌ها: تحلیل و پروفایل `high`، ایده `medium`، تولید `high`.
- **Structured Outputs:** با `output_config.format` و اسکیمای Zod مشترک (`zodOutputFormat`). خروجی پیش از ذخیره دوباره با Zod اعتبارسنجی می‌شود.
- **Refusal:** اگر `stop_reason === "refusal"` باشد، کار با خطای قابل‌فهم شکست می‌خورد.
- **Prompt caching:** بخش ثابت پرامپت سیستم کش می‌شود.
- **تصاویر:** تصاویر استخراج‌شده از نمونه (مثلاً og:image) تا سقف ۴ عدد به‌صورت URL به مدل داده می‌شوند تا ویژگی‌های بصری هم تحلیل شوند.
- **Provider آزمایشی:** با `AI_PROVIDER=mock` خروجی‌های ساختگی ولی معتبر برمی‌گردد. برای توسعه و تست بدون کلید API مناسب است.

## ایمنی در برابر Prompt Injection

محتوای دریافتی از لینک‌ها داخل تگ‌های `<sample_content>` قرار می‌گیرد. در پرامپت سیستم صریحاً آمده است که این محتوا **داده** است و دستورهای داخل آن نباید اجرا شوند. خروجی هم فقط در قالب اسکیما پذیرفته می‌شود، پس مدل نمی‌تواند کاری خارج از آن انجام دهد.

## پرامپت‌ها

پرامپت‌ها در جدول `PromptTemplate` هستند و از بک‌آفیس قابل ویرایش و نسخه‌بندی‌اند. پیش‌فرض‌ها در [`apps/api/src/modules/ai/prompts/defaults.ts`](../apps/api/src/modules/ai/prompts/defaults.ts) تعریف شده‌اند و seed آن‌ها را وارد DB می‌کند.

متغیرهای در دسترس (با `{{name}}`):

| پرامپت | متغیرها |
|---|---|
| `analyze_sample` | `topic`، `sample`، `language` |
| `build_profile` | `topic`، `analyses`، `principles`، `previous_profile`، `language` |
| `ideate` | `topic`، `profile`، `principles`، `existing_ideas`، `count`، `direction`، `format`، `language` |
| `generate_content` | `topic`، `profile`، `principles`، `idea`، `brief`، `format`، `language` |
| `revise_content` | `topic`، `profile`، `principles`، `current_draft`، `feedback`، `language` |
| `smart_chat` | `mode`، `context`، `transcript` |

## ثبت هزینه

در هر `AiJob`، `usage` پاسخ (توکن ورودی و خروجی و کش) ذخیره می‌شود. هزینه با جدول قیمت در [`apps/api/src/modules/ai/pricing.ts`](../apps/api/src/modules/ai/pricing.ts) محاسبه می‌شود. داشبورد بک‌آفیس مجموع هزینه را به تفکیک نوع کار نشان می‌دهد.

## افزودن یک نوع کار AI جدید

1. اسکیمای خروجی را در `packages/shared/src/ai.ts` تعریف کنید.
2. نوع کار را به `AiJobType` در `schema.prisma` و `packages/shared` اضافه کنید.
3. پرامپت پیش‌فرض را به `defaults.ts` اضافه کنید.
4. یک Runner جدید پیاده‌سازی کنید که `AiRunner` را implement کند و در `AiModule` ثبت کنید.
5. endpointی بسازید که `AiJobsService.enqueue()` را صدا بزند.
