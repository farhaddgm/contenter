import { searchTerms, termVariants } from '@contenter/shared';

/**
 * A Prisma `AND` that wants every word of `q` somewhere in the record. `perSpelling` lists the
 * conditions for one spelling of a word (typically one per text field); a word matches when any
 * of its keyboard spellings (ی/ي, ک/ك, digit scripts, half-space) matches any of them.
 * Returns undefined for a query with no words, so it can be spread conditionally.
 */
export function matchAllWords<T>(
  q: string | undefined,
  perSpelling: (spelling: string) => T[],
): { AND: { OR: T[] }[] } | undefined {
  const terms = q ? searchTerms(q) : [];
  if (!terms.length) return undefined;
  return {
    AND: terms.map((term) => ({ OR: termVariants(term).flatMap((v) => perSpelling(v)) })),
  };
}

/** `contains`, ignoring case. */
export const has = (spelling: string) => ({ contains: spelling, mode: 'insensitive' as const });
