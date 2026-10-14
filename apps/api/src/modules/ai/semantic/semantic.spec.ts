import type { AiJob } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import { formatBusinessDocuments } from '../context';
import { MockProvider } from '../provider/mock.provider';
import type { AiProviderRegistry } from '../provider/provider-registry';
import { EmbedReferenceRunner } from '../runners/embed-reference.runner';
import { chunkText, hashText, MAX_CHUNKS_PER_REFERENCE } from './chunking';
import { SemanticRetriever, type DocumentWithId } from './semantic.service';
import { cosine, pickWithinBudget } from './vector';

describe('chunkText', () => {
  it('keeps a short text whole and gives nothing for an empty one', () => {
    expect(chunkText('سلام دنیا')).toEqual(['سلام دنیا']);
    expect(chunkText('  \n ')).toEqual([]);
  });

  it('cuts a long text at paragraph ends, within the size, with an overlap', () => {
    const paragraph = (n: number) => `بند ${n}. ` + 'کلمه '.repeat(100).trim();
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i)).join('\n\n');
    const chunks = chunkText(text, 1000, 100);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    // every paragraph start survives in some chunk
    for (let i = 0; i < 12; i++) expect(chunks.some((c) => c.includes(`بند ${i}.`))).toBe(true);
    // neighbours overlap: the end of one chunk reappears at the start of the next
    const tail = chunks[0].slice(-40).trim().split(' ').slice(-3).join(' ');
    expect(chunks[1]).toContain(tail);
  });

  it('cuts at a sentence end when there is no paragraph break, and never inside a word if it can help it', () => {
    const text = Array.from({ length: 60 }, (_, i) => `این جملهٔ شمارهٔ ${i} است؟`).join(' ');
    const chunks = chunkText(text, 300, 40);
    for (const c of chunks.slice(0, -1)) expect(/[؟.]$/.test(c)).toBe(true);
  });

  it('is deterministic and limited', () => {
    const text = 'الف '.repeat(400_000);
    expect(chunkText(text)).toEqual(chunkText(text));
    expect(chunkText(text).length).toBeLessThanOrEqual(MAX_CHUNKS_PER_REFERENCE);
    expect(hashText('a')).toBe(hashText('a'));
    expect(hashText('a')).not.toBe(hashText('b'));
  });
});

describe('vectors', () => {
  it('computes cosine and treats empty or zero vectors as unrelated', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });

  it('picks the best chunks within the budget, limits one reference, and restores reading order', () => {
    const chunk = (referenceId: string, idx: number, score: number, len = 100) => ({
      referenceId,
      idx,
      text: 'x'.repeat(len),
      score,
    });
    const picked = pickWithinBudget(
      [chunk('B', 0, 0.9), chunk('A', 2, 0.8), chunk('A', 1, 0.7), chunk('A', 0, 0.1), chunk('B', 1, 0.05)],
      300,
      8,
      ['A', 'B'],
    );
    expect(picked.map((c) => `${c.referenceId}${c.idx}`)).toEqual(['A1', 'A2', 'B0']);
    const capped = pickWithinBudget(
      [chunk('A', 0, 0.9), chunk('A', 1, 0.8), chunk('A', 2, 0.7), chunk('B', 0, 0.1)],
      1000,
      2,
      ['A', 'B'],
    );
    expect(capped.map((c) => `${c.referenceId}${c.idx}`)).toEqual(['A0', 'A1', 'B0']);
    // a chunk bigger than what is left is skipped, a smaller one later still fits
    const skip = pickWithinBudget([chunk('A', 0, 0.9, 250), chunk('A', 1, 0.8, 200), chunk('A', 2, 0.7, 40)], 300);
    expect(skip.map((c) => c.idx)).toEqual([0, 2]);
  });
});

// ───────────────────────── the retriever ─────────────────────────

const mock = new MockProvider();

function setup(opts: { embedder?: boolean; chunks?: unknown[]; active?: number } = {}) {
  const enqueue = vi.fn(async () => ({}));
  const prisma = {
    referenceChunk: { findMany: async () => opts.chunks ?? [] },
    aiJob: { count: async () => opts.active ?? 0 },
  };
  const registry = {
    embedder: () =>
      opts.embedder === false ? null : { provider: mock, model: 'm', ref: 'openai:m' },
  } as unknown as AiProviderRegistry;
  const retriever = new SemanticRetriever(
    prisma as unknown as PrismaService,
    registry,
    { get: () => ({ enqueue }) } as never,
  );
  return { retriever, enqueue };
}

const doc = (id: string, content: string): DocumentWithId => ({ id, title: `T${id}`, url: '', content });

/** The chunks of a document as the runner would store them, with the mock model's vectors. */
async function indexed(d: DocumentWithId, size = 400) {
  const pieces = chunkText(d.content, size, 0);
  const { vectors } = await mock.embed(pieces);
  return pieces.map((text, idx) => ({
    referenceId: d.id,
    idx,
    text,
    embedding: vectors[idx],
    contentHash: hashText(d.content),
  }));
}

const sentences = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${topic} موضوع ${topic} شمارهٔ ${i} دربارهٔ ${topic} است.`).join(' ');

describe('SemanticRetriever.select', () => {
  it('does nothing when the documents fit the budget or there is no question', async () => {
    const { retriever } = setup();
    expect(await retriever.select([doc('a', 'کوتاه')], 'هر چیزی', 1000)).toBeNull();
    expect(await retriever.select([doc('a', 'x'.repeat(5000))], '   ', 1000)).toBeNull();
  });

  it('falls back to the whole text when no embeddings vendor is configured', async () => {
    const { retriever } = setup({ embedder: false });
    expect(await retriever.select([doc('a', 'x'.repeat(5000))], 'q', 1000)).toBeNull();
  });

  it('queues indexing for documents without fresh chunks and answers null until they exist', async () => {
    const { retriever, enqueue } = setup();
    const out = await retriever.select([doc('a', 'x'.repeat(5000)), doc('b', 'y'.repeat(5000))], 'q', 1000, 'u1');
    expect(out).toBeNull();
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    expect(enqueue.mock.calls[0][0]).toMatchObject({ type: 'EMBED_REFERENCE', targetId: 'a', userId: 'u1' });
  });

  it('does not queue a second job while one is working on the reference', async () => {
    const { retriever, enqueue } = setup({ active: 1 });
    await retriever.select([doc('a', 'x'.repeat(5000))], 'q', 1000);
    await new Promise((r) => setTimeout(r, 20));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('picks the passages closest in meaning, within the budget, marked as selected', async () => {
    const coffee = doc('a', sentences('قهوه', 40));
    const tax = doc('b', sentences('مالیات', 40));
    const chunks = [...(await indexed(coffee)), ...(await indexed(tax))];
    const { retriever } = setup({ chunks });
    const out = await retriever.select([coffee, tax], 'قهوه تازه و موضوع قهوه', 1200);
    expect(out).not.toBeNull();
    const text = out!.map((d) => d.content).join('\n');
    expect(text.length).toBeLessThanOrEqual(1300);
    // the question is about coffee, so the coffee document supplies most of the budget
    const coffeeLen = out!.find((d) => d.title === 'Ta')?.content.length ?? 0;
    const taxLen = out!.find((d) => d.title === 'Tb')?.content.length ?? 0;
    expect(coffeeLen).toBeGreaterThan(taxLen);
    expect(out!.every((d) => d.selected)).toBe(true);
  });

  it('treats chunks of a changed text as stale: it queues indexing and still uses the old chunks of the others', async () => {
    const a = doc('a', sentences('قهوه', 150));
    const b = doc('b', sentences('مالیات', 150));
    const staleChunks = (await indexed(b)).map((c) => ({ ...c, contentHash: 'old' }));
    const { retriever, enqueue } = setup({ chunks: [...(await indexed(a)), ...staleChunks] });
    const out = await retriever.select([a, b], 'قهوه', 6000);
    expect(out).not.toBeNull();
    // the stale document takes part with its opening excerpt, not with its old chunks
    expect(out!.find((d) => d.title === 'Tb')!.content.length).toBeLessThanOrEqual(2500);
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue.mock.calls[0][0]).toMatchObject({ targetId: 'b' });
  });

  it('never throws: any failure means "use the whole text"', async () => {
    const prisma = {
      referenceChunk: {
        findMany: async () => {
          throw new Error('db down');
        },
      },
    };
    const retriever = new SemanticRetriever(
      prisma as unknown as PrismaService,
      { embedder: () => ({ provider: mock, model: 'm', ref: 'openai:m' }) } as unknown as AiProviderRegistry,
      {} as never,
    );
    expect(await retriever.select([doc('a', 'x'.repeat(5000))], 'q', 1000)).toBeNull();
  });
});

describe('formatBusinessDocuments with selected passages', () => {
  it('keeps selected passages whole and says so, but still cuts whole documents', () => {
    const big = 'ب'.repeat(6000);
    const selected = formatBusinessDocuments([{ title: 'T', url: '', content: big, selected: true }], 4000);
    expect(selected).not.toContain('[truncated]');
    expect(selected).toContain('passages closest in meaning');
    const whole = formatBusinessDocuments([{ title: 'T', url: '', content: big }], 4000);
    expect(whole).toContain('[truncated]');
    expect(whole).not.toContain('passages closest in meaning');
  });
});

// ───────────────────────── the runner ─────────────────────────

function runner(refs: { content: string }, existing: { count: number } = { count: 0 }, embedder = true) {
  const created: unknown[] = [];
  const prisma = {
    businessReference: {
      findUniqueOrThrow: async () => ({ id: 'r1', businessId: 'b1', content: refs.content }),
    },
    referenceChunk: {
      count: async () => existing.count,
      deleteMany: vi.fn(async () => ({})),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        created.push(...data);
      }),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const registry = {
    isMock: true,
    embedder: () => (embedder ? { provider: mock, model: 'm', ref: 'openai:m' } : null),
  } as unknown as AiProviderRegistry;
  return { run: new EmbedReferenceRunner(prisma as unknown as PrismaService, registry), prisma, created };
}

const job = { id: 'j', targetId: 'r1' } as AiJob;

describe('EmbedReferenceRunner', () => {
  it('stores one embedded chunk per piece, replacing the old ones', async () => {
    const { run, prisma, created } = runner({ content: sentences('قهوه', 60) });
    const r = await run.run(job);
    expect(r.output.chunks).toBeGreaterThan(1);
    expect(created).toHaveLength(r.output.chunks as number);
    expect(created[0]).toMatchObject({ referenceId: 'r1', businessId: 'b1', idx: 0, model: 'openai:m' });
    expect((created[0] as { embedding: number[] }).embedding).toHaveLength(128);
    expect(prisma.referenceChunk.deleteMany).toHaveBeenCalled();
    expect(r.model).toBe('mock/m');
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });

  it('does nothing, at no cost, when the chunks are already fresh', async () => {
    const content = sentences('قهوه', 60);
    const first = runner({ content });
    const n = (await first.run.run(job)).output.chunks as number;
    const again = runner({ content }, { count: n });
    const r = await again.run.run(job);
    expect(r.output).toMatchObject({ skipped: 'unchanged' });
    expect(r.usage.inputTokens).toBe(0);
    expect(again.created).toHaveLength(0);
  });

  it('clears the chunks of an emptied reference and refuses to run without a vendor', async () => {
    const empty = runner({ content: '  ' });
    expect((await empty.run.run(job)).output).toMatchObject({ chunks: 0 });
    expect(empty.prisma.referenceChunk.deleteMany).toHaveBeenCalled();
    await expect(runner({ content: 'x' }, { count: 0 }, false).run.run(job)).rejects.toThrow(/No embeddings vendor/);
  });
});
