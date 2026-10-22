/**
 * Stale-content tracker (docs/61-occasions-register-stale.md). A piece of approved or published
 * content goes stale when a key fact of the business changed or expired after it was written:
 * the quality gate already knows how to see that (`FACT_EXPIRED`, `FACT_NUMBER_MISMATCH`, and a
 * catalog price that changed, `OFFERING_PRICE_MISMATCH`, docs/67), so this
 * only runs the same code over the whole business. No model is involved.
 */
import type { ContentFormat, ContentStatus, Platform } from './enums';
import {
  checkContentQuality,
  type QualityFactRule,
  type QualityIssue,
  type QualityIssueCode,
  type QualityOfferingRule,
} from './quality';

export const STALE_CODES = [
  'FACT_EXPIRED',
  'FACT_NUMBER_MISMATCH',
  'OFFERING_PRICE_MISMATCH',
] as const satisfies readonly QualityIssueCode[];
/** Most contents one report looks at. */
export const STALE_MAX_CONTENTS = 300;

export interface StaleCandidate {
  id: string;
  title: string;
  status: ContentStatus;
  platform: Platform;
  format: ContentFormat;
  publishedAt: string | null;
  scheduledAt: string | null;
  topic: { id: string; title: string };
  body: string;
  hashtags: string[];
  cta: string;
  versionTitle: string;
}

export interface StaleContent {
  id: string;
  title: string;
  status: ContentStatus;
  platform: Platform;
  publishedAt: string | null;
  scheduledAt: string | null;
  topic: { id: string; title: string };
  issues: QualityIssue[];
}

export interface StaleReport {
  checked: number;
  /** More contents than `STALE_MAX_CONTENTS` exist; the newest were checked. */
  truncated: boolean;
  items: StaleContent[];
}

/** Contents whose current text clashes with a fact that changed or expired. Pure. */
export function findStale(
  candidates: readonly StaleCandidate[],
  facts: readonly QualityFactRule[],
  now: Date = new Date(),
  offerings: readonly QualityOfferingRule[] = [],
): StaleContent[] {
  if (!facts.length && !offerings.length) return [];
  const out: StaleContent[] = [];
  for (const c of candidates) {
    const report = checkContentQuality({
      title: c.versionTitle,
      body: c.body,
      hashtags: c.hashtags,
      cta: c.cta,
      platform: c.platform,
      format: c.format,
      facts,
      offerings,
      now,
    });
    const issues = report.issues.filter((i) => (STALE_CODES as readonly string[]).includes(i.code));
    if (!issues.length) continue;
    out.push({
      id: c.id,
      title: c.title,
      status: c.status,
      platform: c.platform,
      publishedAt: c.publishedAt,
      scheduledAt: c.scheduledAt,
      topic: c.topic,
      issues,
    });
  }
  // published ones first (they are already out), then the scheduled, then the rest
  const rank = (c: StaleContent) => (c.publishedAt ? 0 : c.scheduledAt ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}
