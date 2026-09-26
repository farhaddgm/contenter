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

- **چند ارائه‌دهنده:** Anthropic (Claude) و OpenAI. مدل به شکل `provider:model` ذخیره می‌شود (مثلاً `openai:gpt-5.4` یا `anthropic:claude-opus-5`) و `AiProviderRegistry` هر کار را به ارائه‌دهندهٔ همان مدل می‌فرستد. شناسهٔ بدون پیشوند از روی نامش تشخیص داده می‌شود (`gpt-`/`o3`… → OpenAI، بقیه → Anthropic).
- ادمین در **پنل ← تنظیمات** مدل پیش‌فرض و مدل هر نوع کار (از جمله «گفتگوی اسمارت») را انتخاب می‌کند؛ مدل دلخواه خارج از فهرست هم قابل افزودن است. اگر در تنظیمات مدلی ذخیره نشده باشد، `AI_DEFAULT_MODEL` استفاده می‌شود.
- کلیدهای API فقط در env سرور (`ANTHROPIC_API_KEY`، `OPENAI_API_KEY`) نگه‌داری می‌شوند و هرگز در DB یا پاسخ API نمی‌آیند؛ صفحهٔ تنظیمات فقط وضعیت «متصل / کلید تنظیم نشده» را نشان می‌دهد. `OPENAI_BASE_URL` اختیاری برای پراکسی/درگاه سازگار با OpenAI است.
- **OpenAI:** از Responses API با Structured Outputs سخت‌گیرانه (`json_schema`، `strict`) استفاده می‌شود؛ اسکیمای JSON از همان اسکیمای Zod ساخته می‌شود. effort در مدل‌های استدلالی (`gpt-5*`، `o*`) به `reasoning.effort` نگاشت می‌شود و اگر مدلی `xhigh`/`max` را نپذیرد با `high` تکرار می‌شود. پاسخ‌ها در OpenAI ذخیره نمی‌شوند (`store: false`). اتمام اعتبار (`insufficient_quota`) و کلید نامعتبر خطای بدون retry هستند.
- **هزینه:** جدول قیمت در `pricing.ts` برای هر دو ارائه‌دهنده است؛ مدل‌های ناشناخته هزینهٔ صفر ثبت می‌کنند.
- **Adaptive thinking** و **effort** قابل‌تنظیم برای هر کار. پیش‌فرض‌ها: تحلیل و پروفایل `high`، ایده `medium`، تولید `high`.
- **Structured Outputs (Claude):** با `output_config.format` و اسکیمای Zod مشترک (`zodOutputFormat`). خروجی پیش از ذخیره دوباره با Zod اعتبارسنجی می‌شود.
- **Refusal:** اگر `stop_reason === "refusal"` باشد، کار با خطای قابل‌فهم شکست می‌خورد.
- **Prompt caching:** بخش ثابت پرامپت سیستم کش می‌شود.
- **تصاویر:** تصاویر استخراج‌شده از نمونه (مثلاً og:image) تا سقف ۴ عدد به‌صورت URL به مدل داده می‌شوند تا ویژگی‌های بصری هم تحلیل شوند.
- **Provider آزمایشی:** با `AI_PROVIDER=mock` همهٔ کارها صرف‌نظر از مدل انتخابی خروجی ساختگی ولی معتبر برمی‌گردانند؛ `AI_PROVIDER=live` حالت واقعی است. برای توسعه و تست بدون کلید API مناسب است.

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
