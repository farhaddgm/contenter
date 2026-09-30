import {
  BusinessSectionKey,
  type BusinessBuildResult,
  type BusinessDiscoveryResult,
  type BusinessAssetAnalysis,
  type BusinessReviseResult,
  type BusinessSuggestResult,
  type ContentDraftResult,
  type IdeationResult,
  type ProfileBuildResult,
  type SampleAnalysisResult,
  type SmartReply,
} from '@contenter/shared';
import {
  NonRetryableAiError,
  type AiProvider,
  type ResearchRequest,
  type ResearchResult,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider';

/** Placeholder Persian text per business section. */
const MOCK_SECTION: Record<BusinessSectionKey, string> = {
  OVERVIEW: 'یک کسب‌وکار نمونه (داده‌ی آزمایشی mock) که خدمات تخصصی به مشتریان شهری ارائه می‌دهد.',
  SERVICES:
    '- **خدمت اصلی**: توضیح کوتاه\n- **خدمت دوم**: توضیح کوتاه\n- **پشتیبانی**: پاسخ‌گویی ۲۴ ساعته',
  TARGET_MARKET: 'خانواده‌ها و کسب‌وکارهای کوچک در شهرهای بزرگ ایران؛ تصمیم خرید آنلاین.',
  PERSONAS:
    '### مریم، ۳۲ ساله، مدیر داخلی\n- هدف: صرفه‌جویی در زمان\n- درد: نبود اعتماد به ارائه‌دهنده‌ها\n- کانال: اینستاگرام\n\n### علی، ۴۵ ساله، صاحب کسب‌وکار\n- هدف: کیفیت پایدار\n- درد: قیمت‌های نامشخص\n- کانال: لینکدین',
  VALUE_PROPOSITION: 'کیفیت تضمینی، قیمت شفاف و پاسخ‌گویی سریع.',
  COMPETITORS: 'رقبای محلی و پلتفرم‌های آنلاین؛ تمایز در ضمانت و خدمات پس از فروش.',
  BRAND_VOICE: 'صمیمی، مطمئن و محترمانه؛ مخاطب با «شما» خطاب می‌شود.',
  BRAND_BOOK:
    '- نام برند همیشه به همین شکل نوشته شود.\n- حداکثر ۲ ایموجی در هر پست.\n- رنگ اصلی: آبی.',
  KEY_MESSAGES: '- «کیفیتی که می‌شود رویش حساب کرد»\n- «قیمت شفاف، بدون هزینهٔ پنهان»',
  CONTENT_PILLARS: '1. آموزش و نکات کاربردی\n2. پشت صحنه و تیم\n3. نظر مشتریان\n4. پیشنهادهای ویژه',
  GUIDELINES:
    '- ادعای «بهترین» یا «ارزان‌ترین» بدون مستند ممنوع است.\n- از مقایسهٔ مستقیم با نام رقبا پرهیز شود.',
  CHANNELS: '- وب‌سایت رسمی\n- اینستاگرام\n- CTA اصلی: «همین حالا مشاوره رایگان بگیرید»',
};

/** Section keys named in `<requested_sections>` of a suggestion prompt. */
function requestedKeys(user: string): BusinessSectionKey[] {
  const raw = /<requested_sections>([\s\S]*?)<\/requested_sections>/.exec(user)?.[1] ?? '';
  const keys = BusinessSectionKey.filter((k) => new RegExp(`\\b${k}\\b`).test(raw));
  return keys.length ? keys : ['OVERVIEW'];
}

/**
 * Deterministic provider for local development, demos and tests (AI_PROVIDER=mock).
 * Returns schema-valid Persian placeholder data without calling any external service.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock';

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise((r) => setTimeout(r, 300));
    const raw = this.fixture(req);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success)
      throw new NonRetryableAiError(`Mock fixture invalid: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: `mock/${req.model}`,
      usage: {
        inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
        outputTokens: Math.ceil(JSON.stringify(raw).length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  async research(req: ResearchRequest): Promise<ResearchResult> {
    await new Promise((r) => setTimeout(r, 300));
    const text = [
      '## یافته‌های تحقیق (mock)',
      'این یادداشت‌ها آزمایشی هستند؛ هیچ جست‌وجوی واقعی انجام نشده است.',
      '- «نمونه‌کالا» یک فروشگاه آنلاین در تهران است (https://example.com).',
      '- «نمونه‌خدمات» یک شرکت خدماتی در اصفهان است (https://example.org).',
    ].join('\n');
    return {
      text,
      sources: [
        { url: 'https://example.com', title: 'نمونه‌کالا' },
        { url: 'https://example.org', title: 'نمونه‌خدمات' },
      ],
      model: `mock/${req.model}`,
      usage: {
        inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        webSearches: 0,
      },
    };
  }

  private fixture(req: StructuredRequest<unknown>): unknown {
    switch (req.task) {
      case 'BUSINESS_DISCOVER': {
        const count = Number(/<count>(\d+)<\/count>/.exec(req.user)?.[1] ?? 3);
        const names = ['نمونه‌کالا', 'نمونه‌خدمات', 'نمونه‌آموزش', 'نمونه‌سلامت', 'نمونه‌سفر'];
        return {
          summary: 'نتیجهٔ آزمایشی (mock): چند کسب‌وکار نمونه مرتبط با کلیدواژه پیدا شد.',
          candidates: Array.from({ length: Math.min(count, names.length) }, (_, i) => ({
            name: names[i]!,
            website: i === 0 ? 'https://example.com' : 'https://example.org',
            location: i % 2 ? 'اصفهان، ایران' : 'تهران، ایران',
            industry: 'خدمات',
            description: 'کسب‌وکار نمونه برای آزمایش جریان ساخت خودکار پروفایل.',
            relevance: 'نام و خدمات آن با کلیدواژه هم‌خوان است.',
            confidence: 0.9 - i * 0.1,
            sourceUrls: ['https://example.com'],
          })),
        } satisfies BusinessDiscoveryResult;
      }
      case 'BUSINESS_BUILD':
        return {
          name:
            /<business_name>([^<]*)<\/business_name>/.exec(req.user)?.[1]?.trim() || 'نمونه‌کالا',
          tagline: 'کیفیتی که می‌شود رویش حساب کرد',
          industry: 'خدمات',
          website: 'https://example.com',
          location: 'تهران، ایران',
          sections: BusinessSectionKey.map((key) => ({ key, content: MOCK_SECTION[key] })),
          gaps: ['قیمت‌ها از منابع عمومی تأیید نشد (mock).'],
        } satisfies BusinessBuildResult;
      case 'BUSINESS_SUGGEST':
        return {
          suggestions: requestedKeys(req.user).map((key) => ({
            key,
            content: MOCK_SECTION[key],
            rationale: 'پیشنهاد آزمایشی (mock) بر اساس اطلاعات فعلی کسب‌وکار.',
          })),
        } satisfies BusinessSuggestResult;
      case 'BUSINESS_REVISE':
        return {
          summary: 'بازبینی آزمایشی (mock): بخش «معرفی» بر اساس توضیح شما به‌روز شد.',
          tagline: '',
          industry: '',
          website: '',
          location: '',
          sections: [
            {
              key: 'OVERVIEW',
              content: `${MOCK_SECTION.OVERVIEW}\n\n(به‌روزشده بر اساس توضیح ادمین — mock)`,
              change: 'توضیح ادمین به معرفی اضافه شد.',
            },
          ],
          gaps: ['قیمت‌ها از منابع عمومی تأیید نشد (mock).'],
        } satisfies BusinessReviseResult;
      case 'BUSINESS_ASSET_ANALYZE':
        return {
          summary: 'تحلیل آزمایشی (mock): یک قطعهٔ تبلیغاتی ساده با پیام اصلی روشن.',
          visualStyle: 'پس‌زمینهٔ روشن، رنگ اصلی آبی، تیتر درشت و لوگو در گوشه.',
          tone: 'صمیمی و مطمئن',
          structure: 'تیتر ← یک جملهٔ توضیح ← دعوت به اقدام',
          messages: ['پیام اصلی نمونه', 'همین حالا امتحان کنید'],
          copy: '',
          guidelines: ['تیتر کوتاه و درشت', 'یک دعوت به اقدام در هر قطعه', 'از شلوغی پرهیز شود'],
          bestFor: 'پست و استوری شبکه‌های اجتماعی',
        } satisfies BusinessAssetAnalysis;
      case 'ANALYZE_SAMPLE':
        return {
          summary: 'نمونه یک پست آموزشی کوتاه است که یک مفهوم را با مثال روزمره توضیح می‌دهد.',
          tone: 'صمیمی، مطمئن و آموزشی',
          voice: 'اول‌شخص؛ یک متخصص که مثل دوست حرف می‌زند',
          audience: 'تازه‌کارهایی که دنبال راهنمای ساده هستند',
          structure: 'قلاب ← مسئله ← سه نکتهٔ شماره‌دار ← جمع‌بندی ← دعوت به اقدام',
          hook: 'با یک سؤال چالشی شروع می‌شود که ذهن مخاطب را درگیر می‌کند',
          length: 'حدود ۱۵۰ کلمه؛ جمله‌های کوتاه',
          formatting: 'خط‌های کوتاه، فهرست شماره‌دار، ۲ تا ۳ ایموجی، ۵ هشتگ در انتها',
          cta: 'دعوت به ذخیرهٔ پست و کامنت نظر',
          visualStyle: 'کاور با تیتر درشت و پس‌زمینهٔ ساده',
          languageNotes: 'فارسی محاوره‌ای-معیار، بدون اصطلاحات تخصصی سنگین',
          strengths: ['قلاب قوی', 'ساختار قابل اسکن', 'مثال ملموس'],
          traits: [
            {
              category: 'HOOK',
              name: 'سؤال چالشی آغازین',
              description: 'پست با یک سؤال تحریک‌کننده شروع می‌شود.',
              evidence: 'خط اول نمونه یک سؤال است.',
            },
            {
              category: 'STRUCTURE',
              name: 'فهرست سه‌نکته‌ای',
              description: 'بدنه در قالب سه نکتهٔ شماره‌دار.',
              evidence: 'سه بند شماره‌دار در بدنه.',
            },
            {
              category: 'TONE',
              name: 'لحن دوستانهٔ متخصص',
              description: 'صمیمی ولی مطمئن.',
              evidence: 'استفاده از «تو» و ارجاع به تجربهٔ شخصی.',
            },
            {
              category: 'CTA',
              name: 'دعوت به ذخیره',
              description: 'پایان با درخواست ذخیره و کامنت.',
              evidence: 'جملهٔ پایانی نمونه.',
            },
          ],
        } satisfies SampleAnalysisResult;
      case 'BUILD_PROFILE':
        return {
          summary: 'سبک مشترک نمونه‌ها: آموزشی، کوتاه، با قلاب سؤالی و ساختار فهرستی.',
          styleGuide:
            '## راهنمای سبک\n\n- با یک **سؤال چالشی** شروع کن.\n- بدنه را در **۳ نکتهٔ شماره‌دار** بنویس.\n- جمله‌ها کوتاه؛ هر خط یک ایده.\n- با دعوت به **ذخیره و کامنت** تمام کن.\n- حداکثر ۳ ایموجی و ۵ هشتگ.',
          traits: [
            {
              category: 'HOOK',
              name: 'قلاب سؤالی',
              description: 'شروع با سؤالی که درد مخاطب را هدف می‌گیرد.',
              evidence: 'در همهٔ نمونه‌ها دیده شد.',
              confidence: 0.9,
            },
            {
              category: 'STRUCTURE',
              name: 'فهرست شماره‌دار',
              description: 'بدنه در ۳ تا ۵ نکتهٔ شماره‌دار.',
              evidence: 'در بیشتر نمونه‌ها.',
              confidence: 0.8,
            },
            {
              category: 'TONE',
              name: 'صمیمی و مطمئن',
              description: 'مخاطب با «تو» خطاب می‌شود؛ بدون تردید.',
              evidence: 'همهٔ نمونه‌ها.',
              confidence: 0.85,
            },
            {
              category: 'LANGUAGE',
              name: 'جمله‌های کوتاه',
              description: 'میانگین کمتر از ۱۲ کلمه در جمله.',
              evidence: 'تحلیل نمونه‌ها.',
              confidence: 0.7,
            },
            {
              category: 'CTA',
              name: 'ذخیره و کامنت',
              description: 'پایان با دعوت به ذخیره.',
              evidence: 'اکثر نمونه‌ها.',
              confidence: 0.75,
            },
          ],
        } satisfies ProfileBuildResult;
      case 'IDEATE': {
        const count = Number(/<count>(\d+)<\/count>/.exec(req.user)?.[1] ?? 5);
        return {
          ideas: Array.from({ length: count }, (_, i) => ({
            title: `ایدهٔ شمارهٔ ${i + 1}: اشتباهی که همه تکرار می‌کنند`,
            angle: 'نگاه از زاویهٔ یک اشتباه رایج و راه‌حل ساده',
            hook: 'فکر می‌کنی این کار رو درست انجام می‌دی؟ احتمالاً نه!',
            format: 'POST',
            outline: [
              'طرح اشتباه رایج',
              'چرا اتفاق می‌افتد',
              'سه راه‌حل عملی',
              'جمع‌بندی و دعوت به ذخیره',
            ],
            rationale: 'با پروفایل (قلاب سؤالی + فهرست) و نیاز مخاطب تازه‌کار هم‌خوان است.',
            score: 7 + (i % 3),
          })),
        } satisfies IdeationResult;
      }
      case 'GENERATE_CONTENT':
      case 'REVISE_CONTENT':
        return {
          title: 'سه اشتباهی که پیشرفتت رو کند می‌کنه',
          body: 'فکر می‌کنی داری درست پیش می‌ری؟ 🤔\n\nبیشتر ما این سه اشتباه رو تکرار می‌کنیم:\n\n1. **شروع بدون هدف مشخص**\nوقتی نمی‌دونی کجا می‌ری، هر مسیری به نظر درسته.\n\n2. **مقایسه با دیگران**\nمسیر هر کس فرق داره؛ خودت رو با دیروزت مقایسه کن.\n\n3. **رها کردن در اولین شکست**\nشکست بخشی از یادگیریه، نه پایانش.\n\n✅ کدوم رو بیشتر تجربه کردی؟ توی کامنت بگو و این پست رو ذخیره کن.',
          hashtags: ['#یادگیری', '#رشد_فردی', '#آموزش', '#انگیزه', '#موفقیت'],
          cta: 'پست رو ذخیره کن و تجربه‌ت رو کامنت کن.',
          notes:
            'کاور: تیتر درشت «۳ اشتباه» روی پس‌زمینهٔ ساده. اسلاید برای هر نکته در صورت کاروسل.',
          selfCheck: {
            score: 8,
            principles: [
              { principle: 'لحن صمیمی', satisfied: true, note: 'مخاطب با «تو» خطاب شده است.' },
            ],
            suggestions: ['می‌توان یک مثال واقعی به نکتهٔ دوم اضافه کرد.'],
          },
        } satisfies ContentDraftResult;
      case 'SMART_CHAT': {
        const last = lastAdminMessage(req.user);
        if (/خلاصه|summar/i.test(last)) {
          return {
            reply:
              '# نمونهٔ گزارش آزمایشی برای دفتر خطاهای واکر\n\n## خلاصه\nاین یک پاسخ آزمایشی (mock) است.\n\n## شرح کامل مسئله\nادمین گزارش داد: ' +
              last.slice(0, 300) +
              '\n\n## مراحل بازتولید\n1. …\n\n## رفتار فعلی\n…\n\n## رفتار مورد انتظار\n…\n\n## شواهد\nاز کانتکست سرور.\n\n## بخش احتمالی درگیر\nنامشخص (حالت mock)\n\n## پیشنهاد رفع\nبا AI واقعی بررسی شود.\n\n## اولویت\nمتوسط',
          } satisfies SmartReply;
        }
        return {
          reply: `این یک پاسخ آزمایشی (mock) از اسمارت است. پیام شما: «${last.slice(0, 200)}»\n\n- کانتکست سرور دریافت شد (${req.user.length} کاراکتر).\n- برای پاسخ واقعی، \`AI_PROVIDER=live\` را تنظیم و در تنظیمات یک مدل انتخاب کنید.`,
        } satisfies SmartReply;
      }
      default:
        throw new NonRetryableAiError(`No mock fixture for task ${req.task}`);
    }
  }
}

/** Text of the last admin message in a Smart chat transcript. */
export function lastAdminMessage(user: string): string {
  const tag = '<message role="admin">\n';
  const start = user.lastIndexOf(tag);
  if (start < 0) return '';
  const body = user.slice(start + tag.length);
  const end = body.indexOf('\n</message>');
  return (end < 0 ? body : body.slice(0, end)).trim();
}
