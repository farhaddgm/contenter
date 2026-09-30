import { isSourceBlocked, type BlockedSource, type WebSource } from '@contenter/shared';
import type { PrismaService } from '../../infra/prisma/prisma.service';

/** The part of a BlockedSource row research needs. */
export type BlockRule = Pick<BlockedSource, 'kind' | 'value'>;

/** Rules listed in the research prompt; the rest are still filtered out of the sources. */
const PROMPT_LIMIT = 200;

/** Every blocklist rule (docs/12-businesses.md — "منابع مسدود"). */
export function loadBlocklist(prisma: PrismaService): Promise<BlockRule[]> {
  return prisma.blockedSource.findMany({
    select: { kind: true, value: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Drops sources that match a rule. */
export function filterSources<T extends WebSource>(sources: T[], rules: BlockRule[]): T[] {
  return rules.length ? sources.filter((s) => !isSourceBlocked(s.url, rules)) : sources;
}

/**
 * Values for a vendor search tool's `blocked_domains` (`host` or `host/path`, subpaths included).
 * A blocked site root (`host` as URL rule) is left out — blocking the host would drop the whole
 * site; that page is excluded by the prompt note and the source filter instead.
 */
export function searchToolBlocklist(rules: BlockRule[]): string[] {
  return [
    ...new Set(
      rules.filter((r) => r.kind === 'DOMAIN' || r.value.includes('/')).map((r) => r.value),
    ),
  ];
}

/** Instruction appended to the research request so every provider avoids blocked sources. */
export function blocklistNote(rules: BlockRule[]): string {
  if (!rules.length) return '';
  const lines = rules
    .slice(0, PROMPT_LIMIT)
    .map((r) =>
      r.kind === 'DOMAIN' ? `- ${r.value} (whole site, with subdomains)` : `- ${r.value}`,
    );
  return [
    '<blocked_sources>',
    'The admin blacklisted these sources as unreliable or irrelevant. Do not open, use or cite them, and do not report facts that only they support:',
    ...lines,
    '</blocked_sources>',
  ].join('\n');
}
