/**
 * Calendar of Iranian occasions (docs/61-occasions-register-stale.md). Pure code: dates are read
 * through `Intl` (ICU converts to the Persian and Islamic calendars), never a hand-written
 * converter, and the model does not pick or date an occasion.
 *
 * Fixed Persian-calendar dates are exact. Islamic-calendar dates depend on the moon sighting, so
 * they come from the tabular `islamic-civil` calendar and are flagged `approximate`: they can be
 * 1–2 days off from the official Iranian calendar. The owner confirms them against the official
 * yearly calendar before relying on them.
 */

export const OccasionKind = [
  'NATIONAL', // Persian-calendar national days and cultural days
  'RELIGIOUS', // Islamic-calendar days
  'SEASONAL', // Nowruz, Yalda, Chaharshanbe Suri…
  'PROFESSION', // teacher's day, engineer's day, book day…
  'COMMERCIAL', // Black Friday, Valentine…
] as const;
export type OccasionKind = (typeof OccasionKind)[number];

/**
 * How to speak on that day. MOURNING: promotions and jokes are inappropriate (Muharram, the
 * mourning days of Safar…). CELEBRATION: a festive tone is welcome.
 */
export const OccasionTone = ['CELEBRATION', 'MOURNING', 'NEUTRAL'] as const;
export type OccasionTone = (typeof OccasionTone)[number];

export interface Occasion {
  id: string;
  /** `YYYY-MM-DD` of the day (Gregorian, Tehran calendar day). */
  date: string;
  fa: string;
  en: string;
  kind: OccasionKind;
  tone: OccasionTone;
  /** An official day off. */
  holiday: boolean;
  /** Islamic-calendar dates (moon sighting): can differ by 1–2 days from the official calendar. */
  approximate: boolean;
}

interface Rule {
  id: string;
  fa: string;
  en: string;
  kind: OccasionKind;
  tone: OccasionTone;
  holiday?: boolean;
}

/** Persian calendar: [month, day]. */
const PERSIAN_RULES: Array<[number, number, Rule]> = [
  [
    1,
    1,
    {
      id: 'nowruz-1',
      fa: 'نوروز (روز اول)',
      en: 'Nowruz (day 1)',
      kind: 'SEASONAL',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    1,
    2,
    {
      id: 'nowruz-2',
      fa: 'نوروز (روز دوم)',
      en: 'Nowruz (day 2)',
      kind: 'SEASONAL',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    1,
    3,
    {
      id: 'nowruz-3',
      fa: 'نوروز (روز سوم)',
      en: 'Nowruz (day 3)',
      kind: 'SEASONAL',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    1,
    4,
    {
      id: 'nowruz-4',
      fa: 'نوروز (روز چهارم)',
      en: 'Nowruz (day 4)',
      kind: 'SEASONAL',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    1,
    12,
    {
      id: 'republic-day',
      fa: 'روز جمهوری اسلامی',
      en: 'Islamic Republic Day',
      kind: 'NATIONAL',
      tone: 'NEUTRAL',
      holiday: true,
    },
  ],
  [
    1,
    13,
    {
      id: 'sizdah-bedar',
      fa: 'سیزده‌بدر',
      en: 'Sizdah Bedar',
      kind: 'SEASONAL',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    2,
    10,
    {
      id: 'persian-gulf-day',
      fa: 'روز ملی خلیج فارس',
      en: 'National Persian Gulf Day',
      kind: 'NATIONAL',
      tone: 'NEUTRAL',
    },
  ],
  [
    2,
    12,
    {
      id: 'teachers-day',
      fa: 'روز معلم',
      en: "Teachers' Day",
      kind: 'PROFESSION',
      tone: 'CELEBRATION',
    },
  ],
  [
    2,
    17,
    {
      id: 'communications-day',
      fa: 'روز ارتباطات و روابط عمومی',
      en: 'Communications and PR Day',
      kind: 'PROFESSION',
      tone: 'CELEBRATION',
    },
  ],
  [
    3,
    14,
    {
      id: 'khomeini-demise',
      fa: 'رحلت امام خمینی',
      en: 'Demise of Imam Khomeini',
      kind: 'NATIONAL',
      tone: 'MOURNING',
      holiday: true,
    },
  ],
  [
    3,
    15,
    {
      id: 'khordad-15',
      fa: 'قیام ۱۵ خرداد',
      en: 'Uprising of 15 Khordad',
      kind: 'NATIONAL',
      tone: 'MOURNING',
      holiday: true,
    },
  ],
  [
    8,
    24,
    {
      id: 'book-day',
      fa: 'روز کتاب و کتاب‌خوانی',
      en: 'Book and Reading Day',
      kind: 'PROFESSION',
      tone: 'CELEBRATION',
    },
  ],
  [
    9,
    16,
    {
      id: 'student-day',
      fa: 'روز دانشجو',
      en: "Students' Day",
      kind: 'PROFESSION',
      tone: 'NEUTRAL',
    },
  ],
  [9, 30, { id: 'yalda', fa: 'شب یلدا', en: 'Yalda Night', kind: 'SEASONAL', tone: 'CELEBRATION' }],
  [
    11,
    22,
    {
      id: 'revolution-day',
      fa: 'پیروزی انقلاب اسلامی',
      en: 'Anniversary of the Revolution',
      kind: 'NATIONAL',
      tone: 'NEUTRAL',
      holiday: true,
    },
  ],
  [
    12,
    5,
    {
      id: 'sepandarmazgan',
      fa: 'سپندارمذگان (روز عشق ایرانی) و روز مهندس',
      en: "Sepandarmazgan and Engineers' Day",
      kind: 'SEASONAL',
      tone: 'CELEBRATION',
    },
  ],
  [
    12,
    15,
    { id: 'tree-day', fa: 'روز درختکاری', en: 'Arbor Day', kind: 'SEASONAL', tone: 'CELEBRATION' },
  ],
  [
    12,
    29,
    {
      id: 'oil-nationalization',
      fa: 'ملی شدن صنعت نفت',
      en: 'Oil Nationalization Day',
      kind: 'NATIONAL',
      tone: 'NEUTRAL',
      holiday: true,
    },
  ],
];

/** Islamic calendar: [month, day]. */
const ISLAMIC_RULES: Array<[number, number, Rule]> = [
  [
    1,
    9,
    {
      id: 'tasua',
      fa: 'تاسوعای حسینی',
      en: "Tasu'a",
      kind: 'RELIGIOUS',
      tone: 'MOURNING',
      holiday: true,
    },
  ],
  [
    1,
    10,
    {
      id: 'ashura',
      fa: 'عاشورای حسینی',
      en: 'Ashura',
      kind: 'RELIGIOUS',
      tone: 'MOURNING',
      holiday: true,
    },
  ],
  [
    2,
    20,
    {
      id: 'arbaeen',
      fa: 'اربعین حسینی',
      en: 'Arbaeen',
      kind: 'RELIGIOUS',
      tone: 'MOURNING',
      holiday: true,
    },
  ],
  [
    2,
    28,
    {
      id: 'prophet-demise',
      fa: 'رحلت پیامبر و شهادت امام حسن مجتبی',
      en: 'Demise of the Prophet and Imam Hasan',
      kind: 'RELIGIOUS',
      tone: 'MOURNING',
      holiday: true,
    },
  ],
  [
    3,
    17,
    {
      id: 'prophet-birth',
      fa: 'ولادت پیامبر اکرم و امام صادق',
      en: 'Birth of the Prophet and Imam Sadiq',
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    6,
    20,
    {
      id: 'mothers-day',
      fa: 'ولادت حضرت فاطمه — روز زن و مادر',
      en: "Fatima's birth — Women's and Mothers' Day",
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
    },
  ],
  [
    7,
    13,
    {
      id: 'fathers-day',
      fa: 'ولادت امام علی — روز پدر',
      en: "Imam Ali's birth — Fathers' Day",
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
    },
  ],
  [
    7,
    27,
    {
      id: 'mab-ath',
      fa: 'مبعث پیامبر اکرم',
      en: "Mab'ath",
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    8,
    15,
    {
      id: 'nimeh-shaban',
      fa: 'نیمهٔ شعبان',
      en: "Mid-Sha'ban",
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    9,
    21,
    {
      id: 'imam-ali-martyrdom',
      fa: 'شهادت امام علی',
      en: 'Martyrdom of Imam Ali',
      kind: 'RELIGIOUS',
      tone: 'MOURNING',
    },
  ],
  [
    10,
    1,
    {
      id: 'eid-fitr',
      fa: 'عید سعید فطر',
      en: 'Eid al-Fitr',
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    10,
    2,
    {
      id: 'eid-fitr-2',
      fa: 'تعطیلی روز بعد از عید فطر',
      en: 'Day after Eid al-Fitr',
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    12,
    10,
    {
      id: 'eid-adha',
      fa: 'عید سعید قربان',
      en: 'Eid al-Adha',
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
  [
    12,
    18,
    {
      id: 'eid-ghadir',
      fa: 'عید سعید غدیر خم',
      en: 'Eid al-Ghadir',
      kind: 'RELIGIOUS',
      tone: 'CELEBRATION',
      holiday: true,
    },
  ],
];

/** Gregorian: [month, day]. */
const GREGORIAN_RULES: Array<[number, number, Rule]> = [
  [
    2,
    14,
    {
      id: 'valentine',
      fa: 'ولنتاین',
      en: "Valentine's Day",
      kind: 'COMMERCIAL',
      tone: 'CELEBRATION',
    },
  ],
  [
    3,
    8,
    {
      id: 'womens-day',
      fa: 'روز جهانی زن',
      en: "International Women's Day",
      kind: 'COMMERCIAL',
      tone: 'CELEBRATION',
    },
  ],
  [
    5,
    1,
    {
      id: 'labour-day',
      fa: 'روز جهانی کارگر',
      en: "International Workers' Day",
      kind: 'PROFESSION',
      tone: 'NEUTRAL',
    },
  ],
  [
    12,
    25,
    { id: 'christmas', fa: 'کریسمس', en: 'Christmas', kind: 'COMMERCIAL', tone: 'CELEBRATION' },
  ],
  [
    1,
    1,
    {
      id: 'new-year',
      fa: 'سال نو میلادی',
      en: 'New Year',
      kind: 'COMMERCIAL',
      tone: 'CELEBRATION',
    },
  ],
];

const DAY_MS = 86_400_000;
const dayKeyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Calendar day `YYYY-MM-DD` → UTC noon (so formatting in UTC never slips a day). */
function noon(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(ms: number, calendar: 'persian' | 'islamic-civil') {
  let f = formatters.get(calendar);
  if (!f) {
    f = new Intl.DateTimeFormat(`en-US-u-ca-${calendar}`, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    formatters.set(calendar, f);
  }
  const out = { year: 0, month: 0, day: 0 };
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === 'year' || p.type === 'month' || p.type === 'day') out[p.type] = Number(p.value);
  }
  return out;
}

/** Longest range the function walks (a year and a bit); the calendar view asks for ≤ 42 days. */
export const OCCASIONS_MAX_DAYS = 400;

/**
 * Occasions on the days from `from` to `to` (both `YYYY-MM-DD`, inclusive), sorted by day. Pure:
 * the same range gives the same answer. A range longer than `OCCASIONS_MAX_DAYS` is cut.
 */
export function occasionsBetween(from: string, to: string): Occasion[] {
  const start = noon(from);
  const end = Math.min(noon(to), start + (OCCASIONS_MAX_DAYS - 1) * DAY_MS);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out: Occasion[] = [];
  const add = (date: string, r: Rule, approximate: boolean) =>
    out.push({
      id: r.id,
      date,
      fa: r.fa,
      en: r.en,
      kind: r.kind,
      tone: r.tone,
      holiday: r.holiday ?? false,
      approximate,
    });

  for (let ms = start; ms <= end; ms += DAY_MS) {
    const date = dayKeyOf(ms);
    const fa = partsOf(ms, 'persian');
    const isl = partsOf(ms, 'islamic-civil');
    const greg = new Date(ms);
    for (const [m, d, r] of PERSIAN_RULES) if (fa.month === m && fa.day === d) add(date, r, false);
    for (const [m, d, r] of ISLAMIC_RULES) if (isl.month === m && isl.day === d) add(date, r, true);
    for (const [m, d, r] of GREGORIAN_RULES) {
      if (greg.getUTCMonth() + 1 === m && greg.getUTCDate() === d) add(date, r, false);
    }
    // Chaharshanbe Suri: the eve of the last Wednesday of Esfand, so the Tuesday whose next day is
    // still in Esfand while the Wednesday a week later is not
    if (greg.getUTCDay() === 2 && fa.month === 12) {
      const nextDay = partsOf(ms + DAY_MS, 'persian');
      const weekLater = partsOf(ms + 8 * DAY_MS, 'persian');
      if (nextDay.month === 12 && weekLater.month !== 12) {
        add(
          date,
          {
            id: 'chaharshanbe-suri',
            fa: 'چهارشنبه‌سوری',
            en: 'Chaharshanbe Suri',
            kind: 'SEASONAL',
            tone: 'CELEBRATION',
          },
          false,
        );
      }
    }
    // Black Friday: the Friday after the fourth Thursday of November
    if (greg.getUTCMonth() === 10 && greg.getUTCDay() === 5) {
      const day = greg.getUTCDate();
      if (day >= 23 && day <= 29) {
        add(
          date,
          {
            id: 'black-friday',
            fa: 'بلک‌فرایدی',
            en: 'Black Friday',
            kind: 'COMMERCIAL',
            tone: 'CELEBRATION',
          },
          false,
        );
      }
    }
  }
  return out;
}

/** The first line of the idea direction for an occasion (the model gets it as the `direction`). */
export function occasionDirection(o: Pick<Occasion, 'fa' | 'tone'>): string {
  const tone =
    o.tone === 'MOURNING'
      ? 'لحن سوگوار و محترمانه؛ بدون تبلیغ، تخفیف، شوخی یا ایموجی شاد.'
      : o.tone === 'CELEBRATION'
        ? 'لحن شاد و صمیمی، متناسب با برند.'
        : 'لحن متناسب با برند و مناسبت.';
  return `ایده‌هایی برای مناسبت «${o.fa}». ${tone}`;
}
