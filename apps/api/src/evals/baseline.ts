/**
 * Baseline and prompt-change guard of the eval (docs/43-persian-eval.md).
 *
 * `evaluated-prompts.json` records, per prompt, the hash of the text that was last evaluated.
 * A unit test compares it with the built-in prompts, so editing a prompt in `defaults.ts` fails
 * CI until someone runs `npm run eval` and records the result. That is how "run the eval on every
 * prompt change" is enforced without a model key in CI.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROMPTS, type PromptDefinition, type PromptKey } from '../modules/ai/prompts/defaults';
import { TASK_META, type EvalTask } from './cases';
import type { EvalReport } from './run-eval';

export const BASELINE_FILE = path.join(__dirname, 'eval-baseline.json');
export const EVALUATED_FILE = path.join(__dirname, 'evaluated-prompts.json');

export const promptHash = (p: Pick<PromptDefinition, 'system' | 'user'>): string =>
  createHash('sha256').update(`${p.system}\n---\n${p.user}`).digest('hex').slice(0, 16);

export interface EvaluatedPrompt {
  hash: string;
  /** When a full eval of exactly this text was recorded; null = never run with a live model. */
  evaluatedAt: string | null;
  model: string | null;
  passRate: number | null;
}
export type EvaluatedPrompts = Partial<Record<PromptKey, EvaluatedPrompt>>;

export interface BaselineEntry {
  model: string;
  judgeModel: string | null;
  cases: number;
  passRate: number;
  avgJudge: number | null;
  at: string;
}
export type Baseline = Partial<Record<EvalTask, BaselineEntry>>;

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

export const readBaseline = (file = BASELINE_FILE): Baseline => readJson<Baseline>(file, {});
export const readEvaluated = (file = EVALUATED_FILE): EvaluatedPrompts =>
  readJson<EvaluatedPrompts>(file, {});

/** The prompts the eval covers, with their current hashes. */
export function currentPromptHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const meta of Object.values(TASK_META)) {
    const def = DEFAULT_PROMPTS.find((p) => p.key === meta.promptKey);
    if (def) out[def.key] = promptHash(def);
  }
  return out;
}

/** Keys whose prompt text changed since it was last recorded in `evaluated-prompts.json`. */
export function stalePrompts(evaluated: EvaluatedPrompts = readEvaluated()): string[] {
  const now = currentPromptHashes();
  return Object.entries(now)
    .filter(([key, hash]) => evaluated[key as PromptKey]?.hash !== hash)
    .map(([key]) => key);
}

export interface Comparison {
  regressed: boolean;
  notes: string[];
}

/** Pass rate may fall by 5 points and the judge mean by 0.3 before a run counts as a regression. */
export const REGRESSION = { passRate: 0.05, judge: 0.3 } as const;

export function compareToBaseline(report: EvalReport, base: BaselineEntry | undefined): Comparison {
  if (!base) return { regressed: false, notes: ['no baseline recorded for this task yet'] };
  const notes: string[] = [];
  let regressed = false;
  if (base.model !== report.model) {
    notes.push(`baseline was measured with ${base.model}; this run used ${report.model}`);
  }
  const drop = base.passRate - report.totals.passRate;
  if (drop > REGRESSION.passRate) {
    regressed = true;
    notes.push(`pass rate fell from ${pct(base.passRate)} to ${pct(report.totals.passRate)}`);
  }
  if (
    base.avgJudge !== null &&
    report.totals.avgJudge !== null &&
    report.judgeTrusted &&
    base.avgJudge - report.totals.avgJudge > REGRESSION.judge
  ) {
    regressed = true;
    notes.push(`judge mean fell from ${base.avgJudge} to ${report.totals.avgJudge}`);
  }
  if (!regressed) notes.push('no regression against the baseline');
  return { regressed, notes };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Records a full, trustworthy run as the new baseline and marks its prompt as evaluated. */
export function recordBaseline(
  report: EvalReport,
  files = { baseline: BASELINE_FILE, evaluated: EVALUATED_FILE },
): { ok: boolean; reason?: string } {
  if (report.partial) return { ok: false, reason: 'the run was partial (--limit / --filter)' };
  if (report.totals.errors > 0) return { ok: false, reason: 'some cases ended in an error' };
  if (report.judgeModel && !report.judgeTrusted) {
    return { ok: false, reason: 'the judge failed calibration' };
  }
  const baseline = readBaseline(files.baseline);
  baseline[report.task] = {
    model: report.model,
    judgeModel: report.judgeModel,
    cases: report.totals.cases,
    passRate: report.totals.passRate,
    avgJudge: report.totals.avgJudge,
    at: report.finishedAt,
  };
  fs.writeFileSync(files.baseline, `${JSON.stringify(baseline, null, 2)}\n`);

  const evaluated = readEvaluated(files.evaluated);
  const key = TASK_META[report.task].promptKey;
  evaluated[key] = {
    hash: report.promptHash,
    evaluatedAt: report.finishedAt,
    model: report.model,
    passRate: report.totals.passRate,
  };
  fs.writeFileSync(files.evaluated, `${JSON.stringify(evaluated, null, 2)}\n`);
  return { ok: true };
}
