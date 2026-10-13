/**
 * Fictional brands for the Persian eval set (docs/43-persian-eval.md). None of them is a real
 * company; names, prices and phone numbers are invented. Each has the things the checks need:
 * exact key facts, terminology rules and principles, so a case can tell a faithful draft from
 * an invented one.
 */
import type { BusinessSectionKey } from '@contenter/shared';
import type { FactForPrompt, TermForPrompt } from '../modules/ai/context';

export interface EvalBrand {
  key: string;
  name: string;
  tagline: string;
  industry: string;
  location: string;
  website: string;
  topic: { title: string; description: string; audience: string };
  sections: { key: BusinessSectionKey; content: string }[];
  facts: FactForPrompt[];
  terms: TermForPrompt[];
  principles: { kind: 'MUST' | 'AVOID' | 'PREFER'; text: string }[];
  profile: {
    summary: string;
    styleGuide: string;
    traits: { category: string; name: string; description: string }[];
  };
  /** A finished Instagram caption, the source of repurposing cases. */
  sourceDraft: { title: string; body: string; hashtags: string[]; cta: string };
}

/** A date some days ahead, so a fixture offer never expires while the set ages. */
const inDays = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);

const fact = (
  category: string,
  label: string,
  value: string,
  validUntil: string | null = null,
): FactForPrompt => ({ category, label, value, verified: true, validUntil });

export const BRANDS: EvalBrand[] = [
  {
    key: 'wallet',
    name: 'آوا‌پی',
    tagline: 'پرداخت ساده، امن و سریع',
    industry: 'فین‌تک (کیف پول دیجیتال)',
    location: 'تهران',
    website: 'https://avapay.example.ir',
    topic: {
      title: 'معرفی خدمات کیف پول آوا',
      description: 'محتوای شبکه‌های اجتماعی برای معرفی کیف پول آوا و آموزش استفادهٔ امن از آن.',
      audience: 'جوانان ۲۰ تا ۴۰ ساله که پرداخت آنلاین دارند',
    },
    sections: [
      {
        key: 'OVERVIEW',
        content:
          'آوا‌پی یک کیف پول دیجیتال ایرانی است که انتقال پول، پرداخت قبوض و خرید آنلاین را در یک اپلیکیشن ساده جمع کرده است.',
      },
      {
        key: 'SERVICES',
        content:
          '- انتقال پول بین کاربران\n- پرداخت قبض و شارژ\n- خرید آنلاین با دکمهٔ پرداخت آوا',
      },
      {
        key: 'BRAND_VOICE',
        content: 'صمیمی ولی مطمئن؛ مخاطب را «شما» خطاب می‌کنیم؛ جمله‌های کوتاه؛ بدون اغراق.',
      },
      {
        key: 'GUIDELINES',
        content:
          '- هیچ وعدهٔ سود یا «بدون ریسک» داده نشود.\n- امنیت را با ویژگی‌های واقعی (رمز دوم، اعلان تراکنش) توضیح دهید.',
      },
      { key: 'CHANNELS', content: '- اینستاگرام و تلگرام\n- دعوت به اقدام: «اپلیکیشن آوا را نصب کنید»' },
    ],
    facts: [
      fact('PRICING', 'کارمزد انتقال پول', '۵۰۰ تومان برای هر انتقال'),
      fact('NUMBERS', 'سقف انتقال روزانه', '۵۰ میلیون تومان'),
      fact('CONTACT', 'ساعت پاسخ‌گویی پشتیبانی', 'هر روز از ۸ صبح تا ۱۰ شب'),
    ],
    terms: [
      { term: 'کیف پول آوا', kind: 'USE', alternatives: ['کیف‌پول آوا', 'کیفپول آوا'], note: '' },
      {
        term: 'بدون ریسک',
        kind: 'AVOID',
        alternatives: ['امن و دارای رمز دوم'],
        note: 'ادعای بدون ریسک ممنوع است',
      },
    ],
    principles: [
      { kind: 'MUST', text: 'هر محتوا یک دعوت به اقدام روشن داشته باشد.' },
      { kind: 'AVOID', text: 'از وعدهٔ سود و ادعای تضمینی استفاده نشود.' },
    ],
    profile: {
      summary: 'لحن صمیمی و کوتاه با مثال‌های روزمره؛ شروع با یک پرسش یا موقعیت آشنا.',
      styleGuide:
        'خط اول قلاب است. جمله‌ها کوتاه. حداکثر دو ایموجی. پایان با دعوت به اقدام.',
      traits: [
        { category: 'HOOK', name: 'شروع با موقعیت آشنا', description: 'خط اول یک لحظهٔ روزمره را می‌گوید.' },
        { category: 'TONE', name: 'صمیمی و مطمئن', description: 'بدون اغراق و بدون وعدهٔ بزرگ.' },
      ],
    },
    sourceDraft: {
      title: 'انتقال پول در چند ثانیه',
      body: 'آخر ماه است و باید سهم دوستانه را بدهی؟\nبا کیف پول آوا انتقال پول فقط چند ثانیه طول می‌کشد. کارمزد هر انتقال ۵۰۰ تومان است و سقف روزانه ۵۰ میلیون تومان.',
      hashtags: ['آوا', 'پرداخت_آنلاین'],
      cta: 'اپلیکیشن آوا را نصب کنید.',
    },
  },
  {
    key: 'clinic',
    name: 'کلینیک پوست مهرآباد',
    tagline: 'مراقبت علمی از پوست',
    industry: 'سلامت و پوست',
    location: 'اصفهان',
    website: 'https://mehrabad-clinic.example.ir',
    topic: {
      title: 'آموزش مراقبت از پوست',
      description: 'محتوای آموزشی دربارهٔ مراقبت از پوست و معرفی خدمات کلینیک، بدون ادعای درمانی.',
      audience: 'زنان و مردان ۲۵ تا ۵۰ ساله که به سلامت پوست اهمیت می‌دهند',
    },
    sections: [
      {
        key: 'OVERVIEW',
        content:
          'کلینیک پوست مهرآباد با پزشکان متخصص پوست، خدمات ویزیت، لیزر و مراقبت‌های پوستی ارائه می‌دهد.',
      },
      { key: 'SERVICES', content: '- ویزیت پوست\n- لیزر موهای زائد\n- پاکسازی پوست' },
      {
        key: 'BRAND_VOICE',
        content: 'مطمئن و آموزشی؛ مثل پزشکی که ساده توضیح می‌دهد؛ بدون ترساندن مخاطب.',
      },
      {
        key: 'GUIDELINES',
        content:
          '- هیچ نتیجهٔ درمانی تضمین نشود.\n- از عبارت‌های «درمان قطعی» و «تضمینی» استفاده نشود.\n- توصیهٔ پزشکی عمومی باشد و ارجاع به ویزیت حضوری داده شود.',
      },
      { key: 'CHANNELS', content: '- اینستاگرام و لینکدین\n- دعوت به اقدام: «نوبت ویزیت بگیرید»' },
    ],
    facts: [
      fact('PRICING', 'هزینهٔ ویزیت', '۴۵۰ هزار تومان'),
      fact('CONTACT', 'ساعت کاری کلینیک', 'شنبه تا چهارشنبه، ۹ صبح تا ۶ عصر'),
      fact('NUMBERS', 'سابقهٔ فعالیت', '۱۲ سال'),
    ],
    terms: [
      { term: 'درمان قطعی', kind: 'AVOID', alternatives: ['مراقبت علمی'], note: 'ادعای پزشکی' },
      { term: 'تضمینی', kind: 'AVOID', alternatives: [], note: 'ادعای تضمینی ممنوع است' },
      { term: 'لیزر موهای زائد', kind: 'USE', alternatives: ['لیزر مو'], note: '' },
    ],
    principles: [
      { kind: 'MUST', text: 'در هر محتوای آموزشی به مراجعهٔ حضوری به پزشک اشاره شود.' },
      { kind: 'AVOID', text: 'مقایسهٔ مستقیم با کلینیک‌های دیگر ممنوع است.' },
    ],
    profile: {
      summary: 'آموزشی و آرام؛ ابتدا یک باور رایج، سپس توضیح علمی ساده.',
      styleGuide: 'شروع با یک پرسش. بدنه در چند بند کوتاه. پایان با دعوت به ویزیت.',
      traits: [
        { category: 'STRUCTURE', name: 'باور رایج و پاسخ علمی', description: 'اول باور اشتباه، بعد توضیح.' },
        { category: 'TONE', name: 'آرام و مطمئن', description: 'بدون ترساندن.' },
      ],
    },
    sourceDraft: {
      title: 'ضدآفتاب را فقط تابستان نمی‌زنیم',
      body: 'فکر می‌کنید ضدآفتاب فقط برای تابستان است؟\nپرتو فرابنفش در تمام فصل‌ها به پوست می‌رسد. استفادهٔ روزانه از ضدآفتاب یکی از ساده‌ترین مراقبت‌هاست. برای انتخاب مناسب، با پزشک پوست مشورت کنید. هزینهٔ ویزیت ۴۵۰ هزار تومان است.',
      hashtags: ['مراقبت_پوست', 'ضدآفتاب'],
      cta: 'نوبت ویزیت بگیرید.',
    },
  },
  {
    key: 'cafe',
    name: 'قهوه‌خانهٔ سپیده',
    tagline: 'قهوهٔ تازه، گفت‌وگوی گرم',
    industry: 'کافه و رستوران',
    location: 'شیراز',
    website: 'https://sepideh-cafe.example.ir',
    topic: {
      title: 'معرفی منو و فضای کافه',
      description: 'محتوای اینستاگرام برای معرفی قهوه، دسر و رویدادهای کافه.',
      audience: 'دانشجویان و فریلنسرهای ۲۰ تا ۳۵ ساله شیراز',
    },
    sections: [
      {
        key: 'OVERVIEW',
        content:
          'قهوه‌خانهٔ سپیده کافه‌ای محلی در شیراز است با قهوهٔ برشته‌شده در همان‌جا و فضایی آرام برای کار و گفت‌وگو.',
      },
      { key: 'SERVICES', content: '- اسپرسو و قهوهٔ دمی\n- دسر خانگی\n- فضای کار مشترک' },
      {
        key: 'BRAND_VOICE',
        content: 'گرم و دوستانه؛ کمی شاعرانه؛ مخاطب «شما» ولی خودمانی.',
      },
      {
        key: 'GUIDELINES',
        content: '- از مقایسه با کافه‌های دیگر پرهیز شود.\n- قیمت‌ها فقط از فهرست رسمی نقل شود.',
      },
      { key: 'CHANNELS', content: '- اینستاگرام\n- دعوت به اقدام: «یک فنجان با ما»' },
    ],
    facts: [
      fact('PRICING', 'قیمت اسپرسو', '۹۵ هزار تومان'),
      fact('CONTACT', 'ساعت کار', 'هر روز از ۸ صبح تا ۱۰ شب'),
      fact('NUMBERS', 'ظرفیت فضای کار مشترک', '۱۲ نفر'),
    ],
    terms: [
      { term: 'قهوه‌خانهٔ سپیده', kind: 'USE', alternatives: ['کافه سپیده', 'قهوه خانه سپیده'], note: '' },
      { term: 'ارزان‌ترین', kind: 'AVOID', alternatives: ['مقرون‌به‌صرفه'], note: 'ادعای قیمت مستند نیست' },
    ],
    principles: [
      { kind: 'MUST', text: 'نام برند به‌صورت «قهوه‌خانهٔ سپیده» نوشته شود.' },
      { kind: 'PREFER', text: 'از تصویرسازی حسی (بو، رنگ، صدا) استفاده شود.' },
    ],
    profile: {
      summary: 'حسی و کوتاه؛ شروع با یک صحنه؛ پایان با دعوت دوستانه.',
      styleGuide: 'خط اول یک صحنه. جمله‌های کوتاه. حداکثر سه ایموجی.',
      traits: [
        { category: 'HOOK', name: 'شروع با صحنه', description: 'خط اول یک صحنهٔ حسی است.' },
        { category: 'TONE', name: 'گرم و شاعرانه', description: 'کمی شاعرانه ولی ساده.' },
      ],
    },
    sourceDraft: {
      title: 'صبح با بوی قهوه',
      body: 'بوی قهوهٔ تازه از در تا میز می‌آید.\nقهوه‌خانهٔ سپیده هر روز از ۸ صبح باز است. اسپرسوی ما ۹۵ هزار تومان است و میز کار آرام هم دارد.',
      hashtags: ['قهوه', 'شیراز'],
      cta: 'امروز یک فنجان با ما.',
    },
  },
  {
    key: 'academy',
    name: 'آکادمی داده‌ورز',
    tagline: 'تحلیل داده از صفر تا کار',
    industry: 'آموزش آنلاین',
    location: 'آنلاین',
    website: 'https://dadevarz.example.ir',
    topic: {
      title: 'جذب دانشجو برای دورهٔ تحلیل داده',
      description: 'محتوای لینکدین و اینستاگرام برای معرفی دورهٔ تحلیل داده و نمونه پروژه‌ها.',
      audience: 'کارمندان و دانشجویانی که می‌خواهند وارد حوزهٔ داده شوند',
    },
    sections: [
      {
        key: 'OVERVIEW',
        content:
          'آکادمی داده‌ورز دورهٔ پروژه‌محور تحلیل داده را با مربی‌های شاغل در صنعت به‌صورت آنلاین برگزار می‌کند.',
      },
      {
        key: 'SERVICES',
        content: '- دورهٔ تحلیل داده (پروژه‌محور)\n- مشاورهٔ مسیر شغلی\n- گروه تمرین هفتگی',
      },
      {
        key: 'BRAND_VOICE',
        content: 'حرفه‌ای و دلگرم‌کننده؛ ساده و بدون اصطلاح بی‌مورد؛ مثال واقعی.',
      },
      {
        key: 'GUIDELINES',
        content: '- وعدهٔ استخدام داده نشود.\n- نتیجه‌ها را به تلاش دانشجو نسبت دهید نه به دوره.',
      },
      { key: 'CHANNELS', content: '- لینکدین و اینستاگرام\n- دعوت به اقدام: «جلسهٔ آشنایی رایگان»' },
    ],
    facts: [
      fact('PRICING', 'شهریهٔ دورهٔ تحلیل داده', '۱۸ میلیون تومان'),
      fact('NUMBERS', 'مدت دوره', '۱۲ هفته و ۶۰ ساعت آموزش'),
      fact('LEGAL', 'ضمانت بازگشت وجه', '۱۴ روز اول'),
    ],
    terms: [
      { term: 'تحلیل داده', kind: 'USE', alternatives: ['آنالیز داده', 'تحلیل دیتا'], note: '' },
      { term: 'تضمین استخدام', kind: 'AVOID', alternatives: [], note: 'وعدهٔ استخدام ممنوع' },
    ],
    principles: [
      { kind: 'MUST', text: 'هر محتوا یک مثال کاربردی از کار با داده داشته باشد.' },
      { kind: 'AVOID', text: 'وعدهٔ درآمد یا استخدام داده نشود.' },
    ],
    profile: {
      summary: 'دلگرم‌کننده و عملی؛ ابتدا مسئله، بعد مثال، بعد قدم بعدی.',
      styleGuide: 'قلاب با یک مسئله. یک مثال کوتاه. پایان با دعوت به جلسهٔ آشنایی.',
      traits: [
        { category: 'STRUCTURE', name: 'مسئله، مثال، قدم بعدی', description: 'سه‌مرحله‌ای.' },
        { category: 'TONE', name: 'دلگرم‌کننده', description: 'بدون اغراق در نتیجه.' },
      ],
    },
    sourceDraft: {
      title: 'اولین پروژهٔ داده',
      body: 'اولین پروژهٔ داده‌ات را با یک فایل فروش ساده شروع کن.\nدر دورهٔ تحلیل داده ما ۱۲ هفته و ۶۰ ساعت با هم کار می‌کنیم. شهریه ۱۸ میلیون تومان است و ۱۴ روز اول امکان بازگشت وجه دارید.',
      hashtags: ['تحلیل_داده', 'آموزش'],
      cta: 'در جلسهٔ آشنایی رایگان شرکت کنید.',
    },
  },
  {
    key: 'tax',
    name: 'مشاوران مالیاتی پارسه',
    tagline: 'مالیات را شفاف مدیریت کنید',
    industry: 'مشاورهٔ مالی و مالیاتی',
    location: 'تبریز',
    website: 'https://parseh-tax.example.ir',
    topic: {
      title: 'آموزش مالیات برای کسب‌وکارهای کوچک',
      description: 'محتوای لینکدین و تلگرام برای آموزش مفاهیم مالیاتی و معرفی مشاورهٔ پارسه.',
      audience: 'صاحبان کسب‌وکار کوچک و حسابداران',
    },
    sections: [
      {
        key: 'OVERVIEW',
        content:
          'مشاوران مالیاتی پارسه به کسب‌وکارهای کوچک در تنظیم اظهارنامه، دفاتر و پاسخ به برگ‌های مالیاتی کمک می‌کند.',
      },
      { key: 'SERVICES', content: '- مشاورهٔ مالیاتی\n- تنظیم اظهارنامه\n- پاسخ به برگ تشخیص' },
      {
        key: 'BRAND_VOICE',
        content: 'رسمی ولی روشن؛ جمله‌های کوتاه؛ مثال عددی ساده؛ بدون ترساندن.',
      },
      {
        key: 'GUIDELINES',
        content:
          '- نرخ و مهلت قانونی را فقط با ارجاع به منبع رسمی بنویسید و در صورت تردید به مشاوره ارجاع دهید.\n- از ادعای «بدون پرداخت مالیات» پرهیز شود.',
      },
      { key: 'CHANNELS', content: '- لینکدین و تلگرام\n- دعوت به اقدام: «مشاورهٔ اولیه رایگان»' },
    ],
    facts: [
      fact('OFFER', 'مشاورهٔ اولیه', '۳۰ دقیقه رایگان'),
      fact('CONTACT', 'تلفن دفتر', '۰۴۱-۳۵۰۰۰۰۰۰'),
      fact('NUMBERS', 'تعداد مشتریان فعال', 'بیش از ۲۰۰ کسب‌وکار'),
    ],
    terms: [
      { term: 'برگ تشخیص', kind: 'USE', alternatives: ['برگه تشخیص'], note: '' },
      { term: 'فرار مالیاتی', kind: 'AVOID', alternatives: ['برنامه‌ریزی مالیاتی'], note: 'اتهام‌آمیز' },
    ],
    principles: [
      { kind: 'MUST', text: 'هر مثال عددی به‌صورت فرضی و «مثلاً» معرفی شود.' },
      { kind: 'AVOID', text: 'نرخ یا مهلت قانونی بدون منبع نوشته نشود.' },
    ],
    profile: {
      summary: 'آموزشی و روشن؛ یک مفهوم در هر پست؛ مثال عددی فرضی.',
      styleGuide: 'عنوان پرسشی. سه بند کوتاه. پایان با دعوت به مشاورهٔ اولیه.',
      traits: [
        { category: 'STRUCTURE', name: 'یک مفهوم در هر پست', description: 'تمرکز روی یک مفهوم.' },
        { category: 'TONE', name: 'رسمی و روشن', description: 'بدون اصطلاح پیچیده.' },
      ],
    },
    sourceDraft: {
      title: 'برگ تشخیص یعنی چه؟',
      body: 'برگ تشخیص مالیات را دریافت کرده‌اید و نمی‌دانید چه کنید؟\nاین برگ نتیجهٔ بررسی اداره مالیات است و می‌توانید در مهلت قانونی به آن اعتراض کنید. اگر مطمئن نیستید، مشاورهٔ اولیهٔ ۳۰ دقیقه‌ای ما رایگان است.',
      hashtags: ['مالیات', 'کسب_و_کار_کوچک'],
      cta: 'مشاورهٔ اولیهٔ رایگان بگیرید.',
    },
  },
  {
    key: 'books',
    name: 'فروشگاه کتاب برگ',
    tagline: 'کتاب خوب، رسیدن سریع',
    industry: 'خرده‌فروشی آنلاین کتاب',
    location: 'مشهد',
    website: 'https://barg-books.example.ir',
    topic: {
      title: 'معرفی کتاب و پیشنهادهای ویژه',
      description: 'محتوای تلگرام و اینستاگرام برای معرفی کتاب، تخفیف‌ها و خدمات ارسال.',
      audience: 'کتاب‌خوان‌های ۱۸ تا ۴۵ ساله',
    },
    sections: [
      {
        key: 'OVERVIEW',
        content:
          'فروشگاه کتاب برگ کتاب‌های ادبیات، روان‌شناسی و کسب‌وکار را آنلاین می‌فروشد و به سراسر ایران ارسال می‌کند.',
      },
      { key: 'SERVICES', content: '- فروش کتاب چاپی\n- ارسال به سراسر کشور\n- بستهٔ هدیه' },
      {
        key: 'BRAND_VOICE',
        content: 'دوستانه و کتاب‌دوست؛ کمی طنز ملایم؛ بدون لحن تبلیغاتی تند.',
      },
      {
        key: 'GUIDELINES',
        content: '- تخفیف فقط با تاریخ پایان بیان شود.\n- از نقد تند کتاب‌ها و نویسنده‌ها پرهیز شود.',
      },
      { key: 'CHANNELS', content: '- تلگرام و اینستاگرام\n- دعوت به اقدام: «همین حالا سفارش دهید»' },
    ],
    facts: [
      fact('OFFER', 'ارسال رایگان', 'برای خرید بالای ۸۰۰ هزار تومان'),
      fact('LEGAL', 'مهلت بازگشت کالا', '۷ روز'),
      fact('OFFER', 'تخفیف پاییزه', '۳۰ درصد روی کتاب‌های ادبیات', inDays(90)),
    ],
    terms: [
      { term: 'فروشگاه کتاب برگ', kind: 'USE', alternatives: ['کتابفروشی برگ', 'برگ بوک'], note: '' },
      { term: 'تخفیف نجومی', kind: 'AVOID', alternatives: [], note: 'اغراق تبلیغاتی' },
    ],
    principles: [
      { kind: 'MUST', text: 'تخفیف‌ها همراه با تاریخ پایان نوشته شود.' },
      { kind: 'PREFER', text: 'یک جملهٔ کوتاه از متن کتاب یا فضای آن بیاید.' },
    ],
    profile: {
      summary: 'کتاب‌دوست و مهربان؛ شروع با یک جمله دربارهٔ کتاب؛ پیشنهاد در پایان.',
      styleGuide: 'خط اول یک جمله دربارهٔ خواندن. بدنهٔ کوتاه. پایان با پیشنهاد و دعوت به سفارش.',
      traits: [
        { category: 'HOOK', name: 'جملهٔ کتاب‌دوستانه', description: 'شروع با یک جمله دربارهٔ خواندن.' },
        { category: 'TONE', name: 'دوستانه با طنز ملایم', description: 'بدون تبلیغ تند.' },
      ],
    },
    sourceDraft: {
      title: 'یک شب، یک کتاب',
      body: 'شبی که فقط یک کتاب لازم داری و یک چای.\nتا آخر سال، ۳۰ درصد تخفیف روی کتاب‌های ادبیات داریم. برای خرید بالای ۸۰۰ هزار تومان ارسال رایگان است و ۷ روز فرصت بازگشت دارید.',
      hashtags: ['کتاب', 'کتابخوانی'],
      cta: 'همین حالا سفارش دهید.',
    },
  },
];

export const brandByKey = (key: string): EvalBrand => {
  const b = BRANDS.find((x) => x.key === key);
  if (!b) throw new Error(`Unknown eval brand ${key}`);
  return b;
};
