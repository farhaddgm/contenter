/**
 * Checks done by code on an eval output (docs/43-persian-eval.md). Pure functions: the same
 * output always gives the same result, so a regression is a real change in the model or prompt,
 * never in the checker. The model-based judge (judge.ts) only adds what code cannot see.
 */
import {
  checkContentQuality,
  checkTerms,
  extractNumbers,
  normalizeTermText,
  persianShare,
  threadPosts,
  type ContentDraftResult,
  type IdeationResult,
} from '@contenter/shared';
import type { EvalCase, EvalExpectation } from './cases';
import { EVAL_NOW } from './cases';

export interface CheckResult {
  name: string;
  passed: boolean;
  /** Short reason, shown in reports; empty when everything is fine. */
  detail: string;
}

const ok = (name: string): CheckResult => ({ name, passed: true, detail: '' });
const fail = (name: string, detail: string): CheckResult => ({ name, passed: false, detail });
const check = (name: string, passed: boolean, detail: string): CheckResult =>
  passed ? ok(name) : fail(name, detail);

/** Numbers a text may contain without being a claim: list markers, counts and years. */
const isHarmless = (n: string) => {
  const v = Number(n);
  return (v >= 0 && v <= 10) || (v >= 1300 && v <= 1500) || (v >= 2000 && v <= 2100);
};

/** Numbers of `output` that appear neither in `source` nor among the harmless ones. */
export function numbersOutsideSource(output: string, source: string): string[] {
  const allowed = new Set(extractNumbers(source));
  return extractNumbers(output).filter((n) => !allowed.has(n) && !isHarmless(n));
}

const wordSet = (s: string) =>
  new Set(
    normalizeTermText(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1),
  );

/** Jaccard similarity of the word sets of two texts, 0..1. */
export function wordOverlap(a: string, b: string): number {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both);
}

const joinDraft = (d: ContentDraftResult) =>
  [d.title, d.body, d.cta, d.hashtags.join(' ')].join('\n');

/** Slides or numbered points a carousel body must have. */
const countSlides = (body: string) =>
  body.split('\n').filter((l) => /^\s*(?:[#*_>-]*\s*)?(?:\d+|[۰-۹]+|[٠-٩]+)[.)\-:/]|^\s*(?:[#*_>-]*\s*)?اسلاید/u.test(l))
    .length;

function formatShape(exp: EvalExpectation, d: ContentDraftResult): CheckResult {
  const name = 'format-shape';
  switch (exp.format) {
    case 'THREAD': {
      const n = threadPosts(d.body).length;
      return check(name, n >= 3, `a thread needs at least 3 posts separated by blank lines; found ${n}`);
    }
    case 'CAROUSEL': {
      const n = countSlides(d.body);
      return check(name, n >= 4, `a carousel needs at least 4 numbered slides; found ${n}`);
    }
    case 'NEWSLETTER':
      return check(name, d.body.trim().length >= 300, 'a newsletter item should have at least 300 characters');
    case 'CAPTION':
      return check(name, !/^\s*#{1,6}\s/m.test(d.body), 'a caption must not use Markdown headings');
    default:
      return check(name, d.body.trim().length >= 40, 'the body is almost empty');
  }
}

/** Every check of a generated or repurposed draft. */
export function checkDraft(c: EvalCase, d: ContentDraftResult, sourceBody?: string): CheckResult[] {
  const exp = c.expect;
  const text = joinDraft(d);
  const results: CheckResult[] = [];

  const share = persianShare(`${d.title}\n${d.body}`);
  results.push(check('persian', share >= 0.6, `only ${Math.round(share * 100)}% of the letters are Persian`));

  const report = checkContentQuality({
    title: d.title,
    body: d.body,
    hashtags: d.hashtags,
    cta: d.cta,
    platform: exp.platform,
    format: exp.format,
    facts: exp.facts,
    terms: exp.terms,
    now: EVAL_NOW,
  });
  const warns = report.issues.filter((i) => i.severity === 'warn');
  results.push(
    check('quality-gate', warns.length === 0, warns.map((i) => i.code).join(', ')),
  );

  results.push(formatShape(exp, d));
  results.push(check('cta-present', d.cta.trim().length > 0, 'the call to action is empty'));

  const badTags = d.hashtags.filter((h) => /\s/.test(h.trim()));
  results.push(check('hashtags-clean', badTags.length === 0, `hashtags with spaces: ${badTags.join('، ')}`));

  const outside = numbersOutsideSource(text, exp.numberSource);
  results.push(check('no-invented-numbers', outside.length === 0, `numbers not in the profile or brief: ${outside.join('، ')}`));

  if (exp.mustQuoteFacts.length) {
    const have = new Set(extractNumbers(text));
    const missing = exp.mustQuoteFacts.filter((label) => {
      const f = exp.facts.find((x) => x.label === label);
      const wanted = f ? extractNumbers(f.value) : [];
      return wanted.length > 0 && !wanted.some((n) => have.has(n));
    });
    results.push(check('quotes-facts', missing.length === 0, `the exact value of these facts is missing: ${missing.join('، ')}`));
  }

  if (exp.bait) {
    const found = normalizeTermText(text).includes(normalizeTermText(exp.bait));
    results.push(check('bait-absent', !found, `the banned term «${exp.bait}» was written`));
  }

  if (sourceBody !== undefined) {
    const similarity = wordOverlap(d.body, sourceBody);
    results.push(check('not-a-copy', similarity < 0.85, `${Math.round(similarity * 100)}% of the words equal the source`));
  }
  return results;
}

/** Every check of an ideation result. */
export function checkIdeas(c: EvalCase, r: IdeationResult): CheckResult[] {
  const exp = c.expect;
  const ideas = r.ideas;
  const results: CheckResult[] = [];

  results.push(check('count-exact', ideas.length === exp.ideaCount, `asked for ${exp.ideaCount}, got ${ideas.length}`));

  const all = ideas.map((i) => [i.title, i.angle, i.hook, ...i.outline, i.rationale].join('\n'));
  const share = persianShare(all.join('\n'));
  results.push(check('persian', share >= 0.6, `only ${Math.round(share * 100)}% of the letters are Persian`));

  let worst = 0;
  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      worst = Math.max(worst, wordOverlap(`${ideas[i].title} ${ideas[i].angle}`, `${ideas[j].title} ${ideas[j].angle}`));
    }
  }
  results.push(check('distinct-angles', worst < 0.7, `two ideas share ${Math.round(worst * 100)}% of their words`));

  const badOutline = ideas.filter((i) => i.outline.length < 3 || i.outline.length > 7).length;
  results.push(check('outline-3-7', badOutline === 0, `${badOutline} ideas have an outline outside 3–7 beats`));

  if (ideas.length >= 3) {
    const distinct = new Set(ideas.map((i) => Math.round(i.score * 10))).size;
    results.push(check('honest-scores', distinct >= 2, 'every idea got the same score'));
  }

  const asked = String(c.vars.format);
  if (asked !== 'any (choose the best)') {
    const wrong = ideas.filter((i) => i.format !== asked).length;
    results.push(check('format-respected', wrong === 0, `${wrong} ideas ignore the requested format ${asked}`));
  }

  const issues = checkTerms(all.join('\n'), exp.terms);
  results.push(check('brand-terms', issues.length === 0, issues.map((i) => `«${i.found}»`).join('، ')));

  const outside = numbersOutsideSource(all.join('\n'), exp.numberSource);
  results.push(check('no-invented-numbers', outside.length === 0, `numbers not in the profile: ${outside.join('، ')}`));
  return results;
}

/** Pass rate of the checks of one case: it passes only when every check passes. */
export const casePassed = (checks: CheckResult[]) => checks.every((c) => c.passed);
