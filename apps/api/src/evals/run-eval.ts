/**
 * Runs eval cases against a provider and builds the report (docs/43-persian-eval.md). The runner
 * takes the provider as an argument, so tests drive it with a fake and the CLI with a real one.
 */
import {
  ContentDraftResultSchema,
  IdeationResultSchema,
  type AiEffort,
  type ContentDraftResult,
  type IdeationResult,
} from '@contenter/shared';
import { estimateCostUsd } from '../modules/ai/pricing';
import { sumUsage, type AiProvider, type AiUsage } from '../modules/ai/provider/ai-provider';
import { DEFAULT_PROMPTS } from '../modules/ai/prompts/defaults';
import { renderTemplate } from '../modules/ai/prompts/render';
import { TASK_META, type EvalCase, type EvalTask } from './cases';
import { casePassed, checkDraft, checkIdeas, type CheckResult } from './checks';
import {
  judgeDraft,
  type CalibrationResult,
  type Judged,
  type JudgeSubject,
} from './judge';
import { promptHash } from './baseline';

export interface CaseResult {
  id: string;
  brand: string;
  intent: string;
  /** Set when the call or the output failed before any check could run. */
  error?: string;
  checks: CheckResult[];
  passed: boolean;
  judge?: Judged;
  /** The model's output as plain text, kept so a failing case can be read. */
  output: string;
  usage: AiUsage;
  costUsd: number;
  ms: number;
}

export interface EvalReport {
  task: EvalTask;
  model: string;
  effort: AiEffort;
  judgeModel: string | null;
  /** Whether the judge passed calibration; null when no judge ran. */
  judgeTrusted: boolean | null;
  calibration: CalibrationResult | null;
  promptHash: string;
  startedAt: string;
  finishedAt: string;
  /** True when a subset of the cases ran (--limit / --filter); such a report never becomes a baseline. */
  partial: boolean;
  totals: {
    cases: number;
    passed: number;
    errors: number;
    passRate: number;
    judged: number;
    judgePassRate: number | null;
    avgJudge: number | null;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  checkRates: Record<string, { passed: number; total: number }>;
  cases: CaseResult[];
}

export interface RunOptions {
  provider: AiProvider;
  model: string;
  effort: AiEffort;
  task: EvalTask;
  cases: EvalCase[];
  /** All cases of the task, to tell a partial run from a full one. */
  totalCases?: number;
  judge?: { provider: AiProvider; model: string; effort: AiEffort; calibration: CalibrationResult };
  concurrency?: number;
  onProgress?: (done: number, total: number, id: string, passed: boolean) => void;
}

const draftText = (d: ContentDraftResult) =>
  [d.title, '', d.body, '', d.cta, '', d.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')]
    .join('\n')
    .trim();

const ideasText = (r: IdeationResult) =>
  r.ideas
    .map(
      (i, n) =>
        `${n + 1}. ${i.title} [${i.format}] (امتیاز ${i.score})\n${i.angle}\nقلاب: ${i.hook}\n${i.outline.map((o) => `- ${o}`).join('\n')}`,
    )
    .join('\n\n');

/** The same trimming the generate and repurpose runners apply before saving. */
export function normalizeDraft(d: ContentDraftResult): ContentDraftResult {
  return { ...d, title: d.title.trim(), hashtags: d.hashtags.map((h) => h.trim()).filter(Boolean) };
}

const emptyUsage = (): AiUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

async function runCase(opts: RunOptions, c: EvalCase): Promise<CaseResult> {
  const started = Date.now();
  const meta = TASK_META[c.task];
  const prompt = DEFAULT_PROMPTS.find((p) => p.key === meta.promptKey)!;
  const base = { id: c.id, brand: c.brand, intent: c.intent };
  try {
    const call = {
      task: meta.jobType,
      model: opts.model,
      effort: opts.effort,
      system: renderTemplate(prompt.system, c.vars),
      user: renderTemplate(prompt.user, c.vars),
    };
    let checks: CheckResult[];
    let output: string;
    let usage: AiUsage;
    let writerUsage: AiUsage;
    let subject: JudgeSubject | null = null;

    if (c.task === 'ideate') {
      const res = await opts.provider.generateStructured({ ...call, schema: IdeationResultSchema });
      checks = checkIdeas(c, res.data);
      output = ideasText(res.data);
      usage = writerUsage = res.usage;
    } else {
      const res = await opts.provider.generateStructured({ ...call, schema: ContentDraftResultSchema });
      const draft = normalizeDraft(res.data);
      const sourceBody =
        c.task === 'repurpose_content'
          ? /Body:\n([\s\S]*?)\n\nHashtags:/.exec(String(c.vars.source))?.[1]
          : undefined;
      checks = checkDraft(c, draft, sourceBody);
      output = draftText(draft);
      usage = writerUsage = res.usage;
      subject = {
        intent: c.intent,
        platform: c.expect.platform,
        format: c.expect.format,
        business: String(c.vars.business),
        brief: c.task === 'generate_content' ? String(c.vars.brief) : `Rewrite this draft:\n${c.vars.source}`,
        draft: output,
      };
    }

    let judge: Judged | undefined;
    if (opts.judge && subject) {
      judge = await judgeDraft(opts.judge.provider, opts.judge.model, opts.judge.effort, subject);
      usage = sumUsage(usage, judge.usage);
    }
    const passed = casePassed(checks) && (judge ? judge.passed : true);
    return {
      ...base,
      checks,
      passed,
      judge,
      output,
      usage,
      costUsd:
        estimateCostUsd(opts.model, writerUsage) +
        (judge ? estimateCostUsd(opts.judge!.model, judge.usage) : 0),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      error: (err as Error).message,
      checks: [],
      passed: false,
      output: '',
      usage: emptyUsage(),
      costUsd: 0,
      ms: Date.now() - started,
    };
  }
}

export async function runEval(opts: RunOptions): Promise<EvalReport> {
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = new Array(opts.cases.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= opts.cases.length) return;
      results[i] = await runCase(opts, opts.cases[i]);
      done += 1;
      opts.onProgress?.(done, opts.cases.length, results[i].id, results[i].passed);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));

  const checkRates: EvalReport['checkRates'] = {};
  for (const r of results) {
    for (const c of r.checks) {
      const e = (checkRates[c.name] ??= { passed: 0, total: 0 });
      e.total += 1;
      if (c.passed) e.passed += 1;
    }
  }
  const judged = results.filter((r) => r.judge);
  const usage = sumUsage(...results.map((r) => r.usage));
  const passed = results.filter((r) => r.passed).length;
  const prompt = DEFAULT_PROMPTS.find((p) => p.key === TASK_META[opts.task].promptKey)!;
  return {
    task: opts.task,
    model: opts.model,
    effort: opts.effort,
    judgeModel: opts.judge?.model ?? null,
    judgeTrusted: opts.judge ? opts.judge.calibration.trusted : null,
    calibration: opts.judge?.calibration ?? null,
    promptHash: promptHash(prompt),
    startedAt,
    finishedAt: new Date().toISOString(),
    partial: opts.totalCases !== undefined && opts.cases.length < opts.totalCases,
    totals: {
      cases: results.length,
      passed,
      errors: results.filter((r) => r.error).length,
      passRate: results.length ? Math.round((passed / results.length) * 1000) / 1000 : 0,
      judged: judged.length,
      judgePassRate: judged.length
        ? Math.round((judged.filter((r) => r.judge!.passed).length / judged.length) * 1000) / 1000
        : null,
      avgJudge: judged.length
        ? Math.round((judged.reduce((s, r) => s + r.judge!.mean, 0) / judged.length) * 100) / 100
        : null,
      costUsd: Math.round(results.reduce((s, r) => s + r.costUsd, 0) * 10_000) / 10_000,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
    checkRates,
    cases: results,
  };
}

/** A short text summary for the terminal. */
export function formatReport(r: EvalReport): string {
  const t = r.totals;
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const lines = [
    `Task ${r.task} · model ${r.model}${r.judgeModel ? ` · judge ${r.judgeModel}` : ''}${r.partial ? ' · PARTIAL RUN' : ''}`,
    `Cases ${t.passed}/${t.cases} passed (${pct(t.passRate)}) · errors ${t.errors} · cost $${t.costUsd}`,
  ];
  if (t.avgJudge !== null) {
    lines.push(`Judge: mean ${t.avgJudge} · pass rate ${pct(t.judgePassRate)}${r.judgeTrusted === false ? ' · JUDGE NOT TRUSTED (failed calibration)' : ''}`);
  }
  lines.push('Checks:');
  for (const [name, v] of Object.entries(r.checkRates)) {
    lines.push(`  ${name.padEnd(22)} ${v.passed}/${v.total}`);
  }
  const failing = r.cases.filter((c) => !c.passed).slice(0, 15);
  if (failing.length) {
    lines.push('First failures:');
    for (const c of failing) {
      const why = c.error
        ? `error: ${c.error}`
        : [...c.checks.filter((x) => !x.passed).map((x) => `${x.name} (${x.detail})`), ...(c.judge && !c.judge.passed ? [`judge ${c.judge.mean}`] : [])].join('; ');
      lines.push(`  - ${c.id}: ${why}`);
    }
  }
  return lines.join('\n');
}
