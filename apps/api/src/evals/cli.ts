/**
 * Command line for the Persian eval (docs/43-persian-eval.md):
 *
 *   npm run eval -w @contenter/api -- --model openai:gpt-5.4 --judge anthropic:claude-sonnet-5 \
 *       [--task generate_content] [--limit 10] [--filter wallet] [--update-baseline]
 *
 * Keys come from the environment or apps/api/.env (OPENAI_API_KEY, ANTHROPIC_API_KEY). Use
 * `--model mock:test` to run the whole pipeline offline with the mock provider.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AiEffort, parseModelRef } from '@contenter/shared';
import type { AiProvider } from '../modules/ai/provider/ai-provider';
import { AnthropicProvider } from '../modules/ai/provider/anthropic.provider';
import { MockProvider } from '../modules/ai/provider/mock.provider';
import { OpenAiProvider } from '../modules/ai/provider/openai.provider';
import { casesFor, EVAL_TASKS, type EvalTask } from './cases';
import { calibrate, assertDifferentFamily } from './judge';
import { compareToBaseline, readBaseline, recordBaseline, stalePrompts } from './baseline';
import { formatReport, runEval } from './run-eval';

function providerFor(ref: string): { provider: AiProvider; model: string } {
  if (ref.startsWith('mock:')) return { provider: new MockProvider(), model: ref.slice(5) };
  const { provider, model } = parseModelRef(ref);
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      `${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} is not set (environment or apps/api/.env)`,
    );
  }
  return {
    provider:
      provider === 'openai'
        ? new OpenAiProvider(key, process.env.OPENAI_BASE_URL)
        : new AnthropicProvider(key, false),
    model,
  };
}

const effortOf = (v: string | undefined, fallback: AiEffort): AiEffort => {
  if (!v) return fallback;
  if (!(AiEffort as readonly string[]).includes(v)) throw new Error(`Unknown effort "${v}"`);
  return v as AiEffort;
};

async function main() {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      judge: { type: 'string' },
      'judge-effort': { type: 'string' },
      'allow-same-family': { type: 'boolean', default: false },
      'skip-calibration': { type: 'boolean', default: false },
      limit: { type: 'string' },
      filter: { type: 'string' },
      concurrency: { type: 'string' },
      out: { type: 'string' },
      'update-baseline': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
    },
  });

  const tasks = values.task ? [values.task as EvalTask] : EVAL_TASKS;
  for (const t of tasks) if (!EVAL_TASKS.includes(t)) throw new Error(`Unknown task "${t}"`);

  if (values.list) {
    for (const t of tasks) console.log(`${t}: ${casesFor(t).length} cases`);
    const stale = stalePrompts();
    console.log(stale.length ? `Prompts changed since the last evaluation: ${stale.join(', ')}` : 'All prompts match their last evaluation.');
    return;
  }
  if (!values.model) throw new Error('--model is required, e.g. --model openai:gpt-5.4');

  const writer = providerFor(values.model);
  const effort = effortOf(values.effort, 'medium');
  let judge: Parameters<typeof runEval>[0]['judge'];
  if (values.judge) {
    if (!values['allow-same-family'] && !values.judge.startsWith('mock:') && !values.model.startsWith('mock:')) {
      assertDifferentFamily(values.model, values.judge);
    }
    const j = providerFor(values.judge);
    const jEffort = effortOf(values['judge-effort'], 'medium');
    console.log(`Calibrating the judge ${values.judge} on the labelled pairs…`);
    const calibration = values['skip-calibration']
      ? { trusted: false, agreed: 0, total: 0, pairs: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
      : await calibrate(j.provider, j.model, jEffort);
    console.log(
      `Judge calibration: ${calibration.agreed}/${calibration.total} pairs ranked correctly → ${calibration.trusted ? 'trusted' : 'NOT trusted'}`,
    );
    judge = { provider: j.provider, model: values.judge, effort: jEffort, calibration };
  }

  const outDir = path.resolve(values.out ?? path.join(__dirname, '..', '..', 'eval-results'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseline = readBaseline();
  let regressed = false;

  for (const task of tasks) {
    const all = casesFor(task);
    let cases = values.filter ? all.filter((c) => c.id.includes(values.filter!)) : all;
    if (values.limit) cases = cases.slice(0, Number(values.limit));
    if (!cases.length) {
      console.log(`${task}: no case matches`);
      continue;
    }
    console.log(`\nRunning ${cases.length} ${task} cases with ${values.model}…`);
    const report = await runEval({
      provider: writer.provider,
      model: values.model,
      effort,
      task,
      cases,
      totalCases: all.length,
      judge,
      concurrency: values.concurrency ? Number(values.concurrency) : 3,
      onProgress: (done, total, id, passed) =>
        console.log(`  [${done}/${total}] ${passed ? 'pass' : 'FAIL'} ${id}`),
    });
    console.log(`\n${formatReport(report)}`);
    const file = path.join(outDir, `${report.finishedAt.replace(/[:.]/g, '-')}-${task}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`Full report: ${file}`);

    const cmp = compareToBaseline(report, baseline[task]);
    console.log(`Baseline: ${cmp.notes.join('; ')}`);
    if (cmp.regressed) regressed = true;

    if (values['update-baseline']) {
      const rec = recordBaseline(report);
      console.log(rec.ok ? `Baseline and evaluated-prompts.json updated for ${task}.` : `Baseline not updated: ${rec.reason}.`);
    }
  }
  if (regressed) process.exitCode = 1;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 2;
});
