import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AiJobsService } from '../ai-jobs.service';
import type { DocumentForPrompt } from '../context';
import { AiProviderRegistry } from '../provider/provider-registry';
import { hashText } from './chunking';
import { cosine, pickWithinBudget, type ScoredChunk } from './vector';

/** A reference that is not indexed yet takes part with its first part, so it is not left out. */
const HEAD_EXCERPT_CHARS = 2_500;
/** The question sent to the embedding model is cut to this many characters. */
const QUERY_CHARS = 6_000;

export interface DocumentWithId extends DocumentForPrompt {
  id: string;
}

/**
 * Picks the passages of a business's references that fit a task, by meaning, when the references
 * are too big to send whole (docs/60-reliability-and-cost.md). Everything is code except the
 * embedding of the question and of the chunks, which is a model call made by the queue worker
 * (the question here, the chunks in `EmbedReferenceRunner`). Cosine similarity is computed in
 * code over vectors stored as plain arrays, so no database extension is needed.
 *
 * It never blocks a job: whenever something is missing (no embeddings vendor, no index yet, an
 * error) it answers `null` and the caller shares the text equally among the documents as before.
 */
@Injectable()
export class SemanticRetriever {
  private readonly logger = new Logger(SemanticRetriever.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiProviderRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * The documents, cut down to the passages most similar to `query`, within `budget` characters;
   * or null when the documents fit anyway or the index cannot be used now.
   */
  async select(
    docs: DocumentWithId[],
    query: string,
    budget: number,
    createdById?: string | null,
  ): Promise<DocumentForPrompt[] | null> {
    try {
      const total = docs.reduce((n, d) => n + d.content.length, 0);
      if (total <= budget || !query.trim()) return null;
      const embedder = this.registry.embedder();
      if (!embedder) return null;

      const hashes = new Map(docs.map((d) => [d.id, hashText(d.content)]));
      const rows = await this.prisma.referenceChunk.findMany({
        where: { referenceId: { in: docs.map((d) => d.id) }, model: embedder.ref },
        select: { referenceId: true, idx: true, text: true, embedding: true, contentHash: true },
      });
      const byRef = new Map<string, typeof rows>();
      for (const r of rows) byRef.set(r.referenceId, [...(byRef.get(r.referenceId) ?? []), r]);

      const fresh = new Set<string>();
      const stale: DocumentWithId[] = [];
      for (const d of docs) {
        const chunks = byRef.get(d.id) ?? [];
        if (chunks.length > 0 && chunks.every((c) => c.contentHash === hashes.get(d.id))) {
          fresh.add(d.id);
        } else {
          stale.push(d);
        }
      }
      if (stale.length) void this.index(stale, createdById);
      if (!fresh.size) return null;

      const { vectors } = await embedder.provider.embed([query.slice(0, QUERY_CHARS)], embedder.model);
      const q = vectors[0];
      if (!q?.length) return null;

      const scored: ScoredChunk[] = [];
      for (const d of docs) {
        if (fresh.has(d.id)) {
          for (const c of byRef.get(d.id) ?? []) {
            scored.push({ referenceId: d.id, idx: c.idx, text: c.text, score: cosine(q, c.embedding) });
          }
        } else {
          scored.push({
            referenceId: d.id,
            idx: 0,
            text: d.content.trim().slice(0, HEAD_EXCERPT_CHARS),
            score: 0,
          });
        }
      }
      const picked = pickWithinBudget(
        scored,
        budget,
        8,
        docs.map((d) => d.id),
      );
      if (!picked.length) return null;

      const byId = new Map(docs.map((d) => [d.id, d]));
      const out: DocumentForPrompt[] = [];
      for (const id of docs.map((d) => d.id)) {
        const parts = picked.filter((p) => p.referenceId === id);
        if (!parts.length) continue;
        const d = byId.get(id)!;
        out.push({ title: d.title, url: d.url, content: parts.map((p) => p.text).join('\n[…]\n'), selected: true });
      }
      return out;
    } catch (err) {
      this.logger.warn(`semantic selection failed, using the whole text: ${(err as Error).message}`);
      return null;
    }
  }

  /** Queues the indexing of references that have no fresh chunks and no job already working on them. */
  async index(refs: { id: string }[], createdById?: string | null): Promise<number> {
    let queued = 0;
    try {
      const jobs = this.moduleRef.get(AiJobsService, { strict: false });
      for (const r of refs) {
        const active = await this.prisma.aiJob.count({
          where: {
            type: 'EMBED_REFERENCE',
            targetId: r.id,
            status: { in: ['QUEUED', 'RUNNING', 'WAITING'] },
          },
        });
        if (active) continue;
        await jobs.enqueue({
          type: 'EMBED_REFERENCE',
          targetType: 'BusinessReference',
          targetId: r.id,
          userId: createdById ?? null,
        });
        queued += 1;
      }
    } catch (err) {
      this.logger.warn(`could not queue indexing: ${(err as Error).message}`);
    }
    return queued;
  }
}
