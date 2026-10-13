/**
 * The pairs (AI draft, approved text) a topic's edits are learned from, and what comes back from
 * the model (docs/30-learn-from-edits.md). Everything here is code: the model sees only the hunks
 * built here and may only point at pair ids; evidence stored with a suggestion is rebuilt from the
 * real pairs, never taken from what the model wrote.
 */
import type { PrismaClient } from '@prisma/client';
import {
  EVIDENCE_EXCERPT_CHARS,
  MAX_EDIT_PAIRS,
  MAX_EDIT_SUGGESTIONS,
  MIN_CHANGE_RATIO,
  MIN_EVIDENCE_PAIRS,
  fold,
  type EditEvidence,
  type EditLearningResult,
} from '@contenter/shared';
import { clip, diffWords, editStats, hunks, words, type EditStats } from './edit-diff';

export interface VersionFields {
  version: number;
  title: string;
  body: string;
  hashtags: string[];
  cta: string;
}

export interface EditPair {
  /** The id the model uses to point at this pair: P1 is the newest. */
  id: string;
  contentId: string;
  contentTitle: string;
  fromVersion: number;
  toVersion: number;
  stats: EditStats;
  hunks: string[];
}

/** The text compared: everything an editor can change in a draft. */
export const versionText = (v: Pick<VersionFields, 'title' | 'body' | 'hashtags' | 'cta'>) =>
  [v.title, v.body, v.hashtags.join(' '), v.cta].filter((part) => part.trim()).join('\n');

export function buildPair(
  index: number,
  content: { id: string; title: string },
  ai: VersionFields,
  approved: VersionFields,
): EditPair {
  const ops = diffWords(words(versionText(ai)), words(versionText(approved)));
  return {
    id: `P${index + 1}`,
    contentId: content.id,
    contentTitle: content.title,
    fromVersion: ai.version,
    toVersion: approved.version,
    stats: editStats(ops),
    hunks: hunks(ops),
  };
}

const VERSION_SELECT = {
  version: true,
  title: true,
  body: true,
  hashtags: true,
  cta: true,
} as const;

/** The conditions of "an editor changed the AI draft and it was approved". */
export const EDITED_APPROVED = {
  status: 'APPROVED',
  currentVersion: { is: { source: 'ADMIN' } },
  versions: { some: { source: 'AI' } },
} as const;

/**
 * The newest edited approved contents of a topic as pairs, keeping only real edits (not a typo
 * fix). The AI side is the last AI draft; the other side is the version that was approved. A
 * content whose approved text is itself an AI revision has no human edit and is not a pair.
 */
export async function collectEditPairs(
  prisma: Pick<PrismaClient, 'content'>,
  topicId: string,
  limit = MAX_EDIT_PAIRS,
): Promise<EditPair[]> {
  const rows = await prisma.content.findMany({
    where: { topicId, ...EDITED_APPROVED },
    orderBy: { updatedAt: 'desc' },
    // a few more than needed: some turn out to be tiny edits
    take: limit * 3,
    select: {
      id: true,
      title: true,
      currentVersion: { select: VERSION_SELECT },
      versions: {
        where: { source: 'AI' },
        orderBy: { version: 'desc' },
        take: 1,
        select: VERSION_SELECT,
      },
    },
  });
  const pairs: EditPair[] = [];
  for (const row of rows) {
    const ai = row.versions[0];
    const approved = row.currentVersion;
    if (!ai || !approved || ai.version >= approved.version) continue;
    const pair = buildPair(pairs.length, row, ai, approved);
    if (pair.stats.changeRatio < MIN_CHANGE_RATIO) continue;
    pairs.push(pair);
    if (pairs.length >= limit) break;
  }
  return pairs;
}

/** The pairs as prompt text: the changed passages only, within a total budget of characters. */
export function formatPairs(pairs: EditPair[], budget = 12_000): string {
  if (!pairs.length) return '(none)';
  const each = Math.max(400, Math.floor(budget / pairs.length));
  return pairs
    .map((p) => {
      const head = `<pair id="${p.id}" title="${p.contentTitle.replace(/"/g, "'")}" changed="${Math.round(
        p.stats.changeRatio * 100,
      )}%" length="${p.stats.lengthDeltaPct > 0 ? '+' : ''}${p.stats.lengthDeltaPct}%">`;
      const lines: string[] = [];
      let used = head.length;
      for (const h of p.hunks) {
        const line = clip(h, Math.min(600, each));
        if (used + line.length > each && lines.length) break;
        lines.push(line);
        used += line.length;
      }
      return [head, ...lines, '</pair>'].join('\n');
    })
    .join('\n\n');
}

/** Mean share of changed words over the pairs. */
export const averageChange = (pairs: EditPair[]) =>
  pairs.length ? pairs.reduce((sum, p) => sum + p.stats.changeRatio, 0) / pairs.length : 0;

const tokens = (text: string) =>
  new Set(
    fold(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1),
  );

/** The same advice in other words: identical once folded, or most of the words shared. */
export function isNearDuplicate(a: string, b: string): boolean {
  if (fold(a).trim() === fold(b).trim()) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.6;
}

export interface ResolvedSuggestion {
  kind: EditLearningResult['suggestions'][number]['kind'];
  category: EditLearningResult['suggestions'][number]['category'];
  text: string;
  rationale: string;
  evidence: EditEvidence[];
}

/**
 * What of the model's answer is kept. A suggestion must point at pairs that exist, at least
 * MIN_EVIDENCE_PAIRS different ones (one edit is not a pattern), and must not repeat a principle,
 * a pending or dismissed suggestion, or another suggestion of the same answer.
 */
export function resolveSuggestions(
  result: EditLearningResult,
  pairs: EditPair[],
  existing: string[],
): ResolvedSuggestion[] {
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const kept: ResolvedSuggestion[] = [];
  for (const s of result.suggestions) {
    const ids = [...new Set(s.evidence)].filter((id) => byId.has(id));
    if (ids.length < MIN_EVIDENCE_PAIRS) continue;
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (existing.some((e) => isNearDuplicate(e, text))) continue;
    if (kept.some((k) => isNearDuplicate(k.text, text))) continue;
    kept.push({
      kind: s.kind,
      category: s.category,
      text,
      rationale: s.rationale.trim(),
      evidence: ids.map((id) => {
        const p = byId.get(id)!;
        return {
          contentId: p.contentId,
          contentTitle: p.contentTitle,
          fromVersion: p.fromVersion,
          toVersion: p.toVersion,
          changeRatio: Math.round(p.stats.changeRatio * 1000) / 1000,
          excerpt: clip(p.hunks[0] ?? '', EVIDENCE_EXCERPT_CHARS),
        };
      }),
    });
    if (kept.length >= MAX_EDIT_SUGGESTIONS) break;
  }
  return kept;
}
