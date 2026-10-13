import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ContentDraftResult, IdeationResult } from '@contenter/shared';
import type { AiProvider, AiUsage, StructuredRequest } from '../modules/ai/provider/ai-provider';
import { DEFAULT_PROMPTS } from '../modules/ai/prompts/defaults';
import { templateVariables } from '../modules/ai/prompts/render';
import { allCases, casesFor, EVAL_TASKS, TASK_META } from './cases';
import { checkDraft, checkIdeas, numbersOutsideSource, wordOverlap } from './checks';
import {
  assertDifferentFamily,
  calibrate,
  CALIBRATION_PAIRS,
  summarizeJudge,
  type JudgeResult,
} from './judge';
import {
  compareToBaseline,
  currentPromptHashes,
  recordBaseline,
  stalePrompts,
  type BaselineEntry,
} from './baseline';
import { formatReport, runEval } from './run-eval';

const usage: AiUsage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

const caseById = (id: string) => {
  const c = allCases().find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

const goodDraft = (over: Partial<ContentDraftResult> = {}): ContentDraftResult => ({
  title: 'انتقال پول در چند ثانیه',
  body: 'آخر ماه است و باید سهم دوستانه را بدهی؟\nبا کیف پول آوا انتقال پول چند ثانیه طول می‌کشد. کارمزد هر انتقال ۵۰۰ تومان است.',
  hashtags: ['آوا'],
  cta: 'اپلیکیشن آوا را نصب کنید.',
  notes: '',
  selfCheck: { score: 8, principles: [], suggestions: [] },
  ...over,
});

describe('the case set', () => {
  it('has the planned size, unique ids and every task covered', () => {
    const cases = allCases();
    expect(casesFor('generate_content')).toHaveLength(42);
    expect(casesFor('repurpose_content')).toHaveLength(36);
    expect(casesFor('ideate')).toHaveLength(12);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(EVAL_TASKS).toEqual(['generate_content', 'repurpose_content', 'ideate']);
  });

  it('gives every prompt variable a value, so the real prompt is rendered completely', () => {
    for (const c of allCases()) {
      const prompt = DEFAULT_PROMPTS.find((p) => p.key === TASK_META[c.task].promptKey)!;
      const needed = templateVariables(`${prompt.system}\n${prompt.user}`);
      const missing = needed.filter((v) => c.vars[v] === undefined);
      expect(missing, `${c.id} lacks ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('carries the brand data the checks rely on', () => {
    const c = caseById('generate_content/wallet/ig-caption-fact');
    expect(String(c.vars.business)).toContain('[FACTS]');
    expect(String(c.vars.business)).toContain('[TERMINOLOGY]');
    expect(c.expect.mustQuoteFacts).toEqual(['کارمزد انتقال پول']);
    const trap = caseById('generate_content/wallet/trap-banned-term');
    expect(trap.expect.bait).toBe('بدون ریسک');
    expect(String(trap.vars.brief)).toContain('بدون ریسک');
  });
});

describe('prompt change guard', () => {
  it('fails when a covered prompt changed after its last recorded evaluation', () => {
    // If this fails you edited a prompt in prompts/defaults.ts: run `npm run eval -w @contenter/api`
    // with a live model and a judge, then `--update-baseline` (docs/43-persian-eval.md).
    expect(stalePrompts()).toEqual([]);
  });

  it('hashes the prompts the eval covers, and a changed text gives another hash', () => {
    expect(Object.keys(currentPromptHashes()).sort()).toEqual(
      ['generate_content', 'ideate', 'repurpose_content'],
    );
    const stale = stalePrompts({ generate_content: { hash: 'old', evaluatedAt: null, model: null, passRate: null } });
    expect(stale).toContain('generate_content');
  });
});

describe('checks on a draft', () => {
  const c = caseById('generate_content/wallet/ig-caption-fact');

  it('passes a faithful Persian draft', () => {
    const results = checkDraft(c, goodDraft());
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });

  it('catches a price that is not in the profile', () => {
    const r = checkDraft(c, goodDraft({ body: 'کارمزد هر انتقال ۵۰۰ تومان است و ۲۰ درصد تخفیف می‌دهیم.' }));
    expect(r.find((x) => x.name === 'no-invented-numbers')?.passed).toBe(false);
  });

  it('catches a fact that is missing or written wrong', () => {
    const r = checkDraft(c, goodDraft({ body: 'با کیف پول آوا انتقال پول چند ثانیه طول می‌کشد.' }));
    expect(r.find((x) => x.name === 'quotes-facts')?.passed).toBe(false);
  });

  it('accepts the number in another script', () => {
    const r = checkDraft(c, goodDraft({ body: 'با کیف پول آوا انتقال پول سریع است. کارمزد هر انتقال 500 تومان است.' }));
    expect(r.find((x) => x.name === 'quotes-facts')?.passed).toBe(true);
  });

  it('catches the banned term of a trap case, and brand terms in the quality gate', () => {
    const trap = caseById('generate_content/wallet/trap-banned-term');
    const r = checkDraft(trap, goodDraft({ body: 'انتقال بدون ریسک با آوا.' }));
    expect(r.find((x) => x.name === 'bait-absent')?.passed).toBe(false);
    expect(r.find((x) => x.name === 'quality-gate')?.passed).toBe(false);
  });

  it('catches text that is not Persian and an empty call to action', () => {
    const r = checkDraft(c, goodDraft({ body: 'Send money in seconds. The fee is 500 toman.', cta: '' }));
    expect(r.find((x) => x.name === 'persian')?.passed).toBe(false);
    expect(r.find((x) => x.name === 'cta-present')?.passed).toBe(false);
  });

  it('checks the shape of a thread and a carousel', () => {
    const thread = caseById('generate_content/wallet/x-thread-education');
    expect(checkDraft(thread, goodDraft({ body: 'پست اول\n\nپست دوم' })).find((x) => x.name === 'format-shape')?.passed).toBe(false);
    expect(
      checkDraft(thread, goodDraft({ body: 'پست اول\n\nپست دوم\n\nپست سوم\n\nپست چهارم' })).find((x) => x.name === 'format-shape')?.passed,
    ).toBe(true);
    const carousel = caseById('generate_content/wallet/ig-carousel-howto');
    const slides = '۱. باز کردن اپ\n۲. انتخاب مقصد\n۳. وارد کردن مبلغ\n۴. تأیید با رمز دوم\n۵. دریافت اعلان';
    expect(checkDraft(carousel, goodDraft({ body: slides })).find((x) => x.name === 'format-shape')?.passed).toBe(true);
    expect(checkDraft(carousel, goodDraft({ body: 'فقط یک متن' })).find((x) => x.name === 'format-shape')?.passed).toBe(false);
  });

  it('flags a repurposed draft that is a copy of its source', () => {
    const rc = caseById('repurpose_content/wallet/telegram');
    const source = 'آخر ماه است و باید سهم دوستانه را بدهی؟ با کیف پول آوا انتقال پول فقط چند ثانیه طول می‌کشد.';
    const copy = checkDraft(rc, goodDraft({ body: source }), source);
    expect(copy.find((x) => x.name === 'not-a-copy')?.passed).toBe(false);
    const fresh = checkDraft(rc, goodDraft(), source);
    expect(fresh.find((x) => x.name === 'not-a-copy')?.passed).toBe(true);
  });

  it('measures numbers and overlap', () => {
    expect(numbersOutsideSource('قیمت ۵۰۰ تومان و ۲۴۰ نفر', 'قیمت ۵۰۰ تومان')).toEqual(['240']);
    expect(numbersOutsideSource('سه نکته: ۱ و ۲ و ۳', '')).toEqual([]);
    expect(wordOverlap('سلام دنیا خوب', 'سلام دنیا بد')).toBeCloseTo(0.5);
    expect(wordOverlap('', 'الف')).toBe(0);
  });
});

describe('checks on ideas', () => {
  const c = caseById('ideate/wallet/five-any');
  const idea = (n: number, over: Record<string, unknown> = {}) => ({
    title: `ایدهٔ ${['اول', 'دوم', 'سوم', 'چهارم', 'پنجم'][n]} دربارهٔ ${['شب', 'نقشه', 'کتاب', 'پنجره', 'باران'][n]}`,
    angle: `زاویهٔ ${['امنیت', 'سرعت', 'قبض', 'خرید', 'دوستان'][n]} در پرداخت`,
    hook: 'یک قلاب خوب',
    format: 'POST' as const,
    outline: ['قلاب', 'توضیح', 'دعوت'],
    rationale: 'مناسب مخاطب',
    score: 6 + n,
    ...over,
  });
  const result = (over: Partial<IdeationResult> = {}): IdeationResult => ({
    ideas: [0, 1, 2, 3, 4].map((n) => idea(n)),
    ...over,
  });

  it('passes a varied set of five', () => {
    expect(checkIdeas(c, result()).filter((r) => !r.passed)).toEqual([]);
  });

  it('catches a wrong count, near-duplicates, short outlines and uniform scores', () => {
    const wrongCount = checkIdeas(c, { ideas: result().ideas.slice(0, 3) });
    expect(wrongCount.find((r) => r.name === 'count-exact')?.passed).toBe(false);

    const same = idea(0);
    const dup = checkIdeas(c, { ideas: [same, { ...same }, idea(2), idea(3), idea(4)] });
    expect(dup.find((r) => r.name === 'distinct-angles')?.passed).toBe(false);

    const short = checkIdeas(c, { ideas: [idea(0, { outline: ['یک'] }), idea(1), idea(2), idea(3), idea(4)] });
    expect(short.find((r) => r.name === 'outline-3-7')?.passed).toBe(false);

    const flat = checkIdeas(c, { ideas: [0, 1, 2, 3, 4].map((n) => idea(n, { score: 9 })) });
    expect(flat.find((r) => r.name === 'honest-scores')?.passed).toBe(false);
  });

  it('checks that the requested format is respected', () => {
    const carousel = caseById('ideate/wallet/three-carousel');
    const ideas = [0, 1, 2].map((n) => idea(n, { format: 'POST' }));
    expect(checkIdeas(carousel, { ideas }).find((r) => r.name === 'format-respected')?.passed).toBe(false);
    const ok = [0, 1, 2].map((n) => idea(n, { format: 'CAROUSEL' }));
    expect(checkIdeas(carousel, { ideas: ok }).find((r) => r.name === 'format-respected')?.passed).toBe(true);
  });
});

describe('judge', () => {
  const raw = (v: number): JudgeResult => ({
    fluency: v,
    naturalness: v,
    brandFit: v,
    faithfulness: v,
    platformFit: v,
    usefulness: v,
    problems: [],
    verdict: 'x',
  });

  it('clamps scores to 1–5 and applies the pass rule', () => {
    expect(summarizeJudge(raw(9), usage).scores.fluency).toBe(5);
    expect(summarizeJudge(raw(0), usage).scores.fluency).toBe(1);
    expect(summarizeJudge(raw(4), usage).passed).toBe(true);
    expect(summarizeJudge(raw(3), usage).passed).toBe(false); // mean 3 < 3.5
    expect(summarizeJudge({ ...raw(5), faithfulness: 2 }, usage).passed).toBe(false); // one dimension below 3
  });

  it('refuses a judge from the same vendor as the writer', () => {
    expect(() => assertDifferentFamily('openai:gpt-5.4', 'openai:gpt-5-mini')).toThrow(/same vendor/);
    expect(() => assertDifferentFamily('openai:gpt-5.4', 'anthropic:claude-sonnet-5')).not.toThrow();
  });

  /** A judge that scores a draft by a marker in it: "GOOD" high, otherwise low. */
  const markerJudge = (high: number, low: number): AiProvider => ({
    name: 'fake',
    research: vi.fn(),
    generateStructured: async <T>(req: StructuredRequest<T>) => {
      const good = CALIBRATION_PAIRS.some((p) => req.user.includes(p.good));
      return { data: raw(good ? high : low) as T, model: 'fake', usage };
    },
  });

  it('trusts a judge that ranks the good draft above the bad one', async () => {
    const r = await calibrate(markerJudge(5, 2), 'fake', 'low');
    expect(r.trusted).toBe(true);
    expect(r.agreed).toBe(CALIBRATION_PAIRS.length);
    expect(r.usage.inputTokens).toBe(usage.inputTokens * CALIBRATION_PAIRS.length * 2);
  });

  it('does not trust a judge that scores everything the same', async () => {
    const r = await calibrate(markerJudge(4, 4), 'fake', 'low');
    expect(r.trusted).toBe(false);
    expect(r.agreed).toBe(0);
  });
});

describe('runEval', () => {
  const writer = (draft: ContentDraftResult, ideas?: IdeationResult): AiProvider => ({
    name: 'fake',
    research: vi.fn(),
    generateStructured: async <T>(req: StructuredRequest<T>) => ({
      data: (req.task === 'IDEATE' ? ideas : draft) as T,
      model: 'fake',
      usage,
    }),
  });

  const cases = [
    caseById('generate_content/wallet/ig-caption-fact'),
    caseById('generate_content/wallet/li-post-expertise'),
  ];

  it('runs every case, counts passes and reports check rates', async () => {
    const seen: string[] = [];
    const report = await runEval({
      provider: writer(goodDraft()),
      model: 'gpt-5',
      effort: 'low',
      task: 'generate_content',
      cases,
      totalCases: 42,
      concurrency: 2,
      onProgress: (_d, _t, id) => seen.push(id),
    });
    expect(seen.sort()).toEqual(cases.map((c) => c.id).sort());
    expect(report.partial).toBe(true);
    expect(report.totals).toMatchObject({ cases: 2, passed: 2, errors: 0, passRate: 1 });
    expect(report.checkRates['persian']).toEqual({ passed: 2, total: 2 });
    expect(report.totals.costUsd).toBeGreaterThan(0);
    expect(report.totals.inputTokens).toBe(2000);
    expect(report.promptHash).toBe(currentPromptHashes()['generate_content']);
  });

  it('renders the real prompt: the system text and the brief reach the provider', async () => {
    const generate = vi.fn(async <T>(_req: StructuredRequest<T>) => ({ data: goodDraft() as T, model: 'fake', usage }));
    await runEval({
      provider: { name: 'fake', research: vi.fn(), generateStructured: generate },
      model: 'gpt-5',
      effort: 'low',
      task: 'generate_content',
      cases: [cases[0]],
    });
    const req = generate.mock.calls[0][0];
    expect(req.system).toContain('expert content writer');
    expect(req.user).toContain('کارمزد انتقال پول');
    expect(req.user).not.toMatch(/\{\{/);
    expect(req.task).toBe('GENERATE_CONTENT');
  });

  it('records a provider error as a failed case instead of stopping', async () => {
    const report = await runEval({
      provider: {
        name: 'fake',
        research: vi.fn(),
        generateStructured: async () => {
          throw new Error('boom');
        },
      },
      model: 'gpt-5',
      effort: 'low',
      task: 'generate_content',
      cases,
    });
    expect(report.totals).toMatchObject({ passed: 0, errors: 2 });
    expect(report.cases[0].error).toBe('boom');
    expect(formatReport(report)).toContain('error: boom');
  });

  it('adds the judge: a case passes only when the judge passes too', async () => {
    const judge = (v: number): AiProvider => ({
      name: 'judge',
      research: vi.fn(),
      generateStructured: async <T>() => ({
        data: {
          fluency: v,
          naturalness: v,
          brandFit: v,
          faithfulness: v,
          platformFit: v,
          usefulness: v,
          problems: [],
          verdict: 'ok',
        } as T,
        model: 'judge',
        usage,
      }),
    });
    const calibration = { trusted: true, agreed: 6, total: 6, pairs: [], usage };
    const good = await runEval({
      provider: writer(goodDraft()),
      model: 'gpt-5',
      effort: 'low',
      task: 'generate_content',
      cases,
      judge: { provider: judge(5), model: 'anthropic:claude-sonnet-5', effort: 'low', calibration },
    });
    expect(good.totals).toMatchObject({ passed: 2, judged: 2, avgJudge: 5, judgePassRate: 1 });
    expect(good.judgeTrusted).toBe(true);
    const bad = await runEval({
      provider: writer(goodDraft()),
      model: 'gpt-5',
      effort: 'low',
      task: 'generate_content',
      cases,
      judge: { provider: judge(2), model: 'anthropic:claude-sonnet-5', effort: 'low', calibration },
    });
    expect(bad.totals).toMatchObject({ passed: 0, judgePassRate: 0 });
  });

  it('runs an ideation case through the ideation checks', async () => {
    const c = caseById('ideate/wallet/five-any');
    const titles = [
      ['امنیت پرداخت', 'رمز دوم چطور از حساب شما محافظت می‌کند'],
      ['سرعت انتقال', 'مقایسهٔ چند ثانیه انتقال با صف بانک'],
      ['قبض‌ها', 'پرداخت همهٔ قبض‌های خانه در یک صفحه'],
      ['خرید آنلاین', 'دکمهٔ پرداخت آوا در فروشگاه‌های اینترنتی'],
      ['سهم دوستانه', 'تقسیم هزینهٔ شام با دوستان بدون حساب‌وکتاب'],
    ];
    const ideas: IdeationResult = {
      ideas: titles.map(([title, angle], n) => ({
        title,
        angle,
        hook: 'قلاب',
        format: 'POST' as const,
        outline: ['یک', 'دو', 'سه'],
        rationale: 'مناسب',
        score: 5 + n,
      })),
    };
    const report = await runEval({
      provider: writer(goodDraft(), ideas),
      model: 'gpt-5',
      effort: 'low',
      task: 'ideate',
      cases: [c],
    });
    expect(report.totals.passed).toBe(1);
    expect(Object.keys(report.checkRates)).toContain('distinct-angles');
  });
});

describe('baseline', () => {
  const entry: BaselineEntry = {
    model: 'gpt-5',
    judgeModel: 'anthropic:claude-sonnet-5',
    cases: 42,
    passRate: 0.8,
    avgJudge: 4,
    at: '2026-10-13T00:00:00Z',
  };
  const report = (over: Record<string, unknown> = {}, totals: Record<string, unknown> = {}) =>
    ({
      task: 'generate_content',
      model: 'gpt-5',
      judgeModel: 'anthropic:claude-sonnet-5',
      judgeTrusted: true,
      partial: false,
      promptHash: 'abc',
      finishedAt: '2026-10-14T00:00:00Z',
      totals: { cases: 42, passed: 34, errors: 0, passRate: 0.8, avgJudge: 4, ...totals },
      ...over,
    }) as unknown as Parameters<typeof compareToBaseline>[0];

  it('accepts a small dip and flags a real drop of pass rate or judge mean', () => {
    expect(compareToBaseline(report({}, { passRate: 0.77 }), entry).regressed).toBe(false);
    expect(compareToBaseline(report({}, { passRate: 0.7 }), entry).regressed).toBe(true);
    expect(compareToBaseline(report({}, { avgJudge: 3.5 }), entry).regressed).toBe(true);
    expect(compareToBaseline(report({ judgeTrusted: false }, { avgJudge: 3.5 }), entry).regressed).toBe(false);
    expect(compareToBaseline(report(), undefined).regressed).toBe(false);
    expect(compareToBaseline(report({ model: 'gpt-6' }), entry).notes.join(' ')).toContain('baseline was measured with gpt-5');
  });

  it('records only a full, error-free run with a trusted judge', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
    const files = { baseline: path.join(dir, 'b.json'), evaluated: path.join(dir, 'e.json') };
    expect(recordBaseline(report({ partial: true }), files).ok).toBe(false);
    expect(recordBaseline(report({}, { errors: 1 }), files).ok).toBe(false);
    expect(recordBaseline(report({ judgeTrusted: false }), files).ok).toBe(false);
    expect(fs.existsSync(files.baseline)).toBe(false);

    expect(recordBaseline(report(), files).ok).toBe(true);
    const base = JSON.parse(fs.readFileSync(files.baseline, 'utf8'));
    expect(base.generate_content).toMatchObject({ model: 'gpt-5', passRate: 0.8, cases: 42 });
    const evaluated = JSON.parse(fs.readFileSync(files.evaluated, 'utf8'));
    expect(evaluated.generate_content).toMatchObject({ hash: 'abc', model: 'gpt-5' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
