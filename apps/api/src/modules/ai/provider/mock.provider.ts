import type {
  ContentDraftResult,
  IdeationResult,
  ProfileBuildResult,
  SampleAnalysisResult,
  SmartReply,
} from '@contenter/shared';
import {
  NonRetryableAiError,
  type AiProvider,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider';

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

  private fixture(req: StructuredRequest<unknown>): unknown {
    switch (req.task) {
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
        const last =
          /<message role="admin">\n([\s\S]*?)\n<\/message>(?![\s\S]*<message role="admin">)/.exec(
            req.user,
          )?.[1] ?? '';
        if (/خلاصه|summar/i.test(last)) {
          return {
            reply:
              '# نمونهٔ گزارش آزمایشی برای دفتر خطاهای واکر\n\n## خلاصه\nاین یک پاسخ آزمایشی (mock) است.\n\n## شرح کامل مسئله\nادمین گزارش داد: ' +
              last.slice(0, 300) +
              '\n\n## مراحل بازتولید\n1. …\n\n## رفتار فعلی\n…\n\n## رفتار مورد انتظار\n…\n\n## شواهد\nاز کانتکست سرور.\n\n## بخش احتمالی درگیر\nنامشخص (حالت mock)\n\n## پیشنهاد رفع\nبا AI واقعی بررسی شود.\n\n## اولویت\nمتوسط',
          } satisfies SmartReply;
        }
        return {
          reply: `این یک پاسخ آزمایشی (mock) از اسمارت است. پیام شما: «${last.slice(0, 200)}»\n\n- کانتکست سرور دریافت شد (${req.user.length} کاراکتر).\n- برای پاسخ واقعی، \`AI_PROVIDER=anthropic\` را تنظیم کنید.`,
        } satisfies SmartReply;
      }
      default:
        throw new NonRetryableAiError(`No mock fixture for task ${req.task}`);
    }
  }
}
