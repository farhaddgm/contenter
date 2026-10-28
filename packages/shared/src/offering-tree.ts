/**
 * The product tree of a business (docs/73-offering-hierarchy.md): a line holds products, a product
 * holds variants — at most `OFFERING_TREE_DEPTH_MAX` levels. Pure: the API checks a move with
 * `offeringParentProblem`, the prompt and the UI order rows with `orderOfferingTree`, and the quality
 * gate reads the phrases a variant inherits with `effectiveGuardrails`.
 */
import {
  OFFERING_GUARDRAILS_MAX,
  OFFERING_TREE_DEPTH_MAX,
  offeringQualityRule,
  type GuardrailAncestor,
  type OfferingCore,
} from './business-catalog';
import type { QualityOfferingRule } from './quality';

/** What the tree needs of a row. */
export interface TreeNode {
  id?: string;
  parentId?: string | null;
}

/** Ids of the ancestors of `id`, nearest first; stops at a missing parent or a cycle. */
export function offeringAncestors(id: string, byId: ReadonlyMap<string, TreeNode>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cursor = byId.get(id)?.parentId ?? null;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return out;
}

/** Levels under `id` (0 = no children). A cycle ends the walk instead of looping. */
function height(id: string, children: ReadonlyMap<string, string[]>, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  let deepest = 0;
  for (const child of children.get(id) ?? []) deepest = Math.max(deepest, 1 + height(child, children, seen));
  return deepest;
}

const childrenOf = (rows: readonly TreeNode[]) => {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.id || !r.parentId) continue;
    map.set(r.parentId, [...(map.get(r.parentId) ?? []), r.id]);
  }
  return map;
};

/**
 * Why `id` (a row being created when it is undefined) cannot sit under `parentId`, or null when it
 * can: the parent must be one of `rows` (the business's own offerings), not the row itself or one of
 * its descendants, and the row with everything under it must fit in `OFFERING_TREE_DEPTH_MAX` levels.
 */
export function offeringParentProblem(args: {
  id?: string;
  parentId: string | null | undefined;
  rows: readonly (TreeNode & { id: string })[];
}): string | null {
  const { id, parentId, rows } = args;
  if (!parentId) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(parentId)) return 'The parent must be an offering of the same business';
  if (id && parentId === id) return 'An offering cannot be its own parent';
  if (id && offeringAncestors(parentId, byId).includes(id)) {
    return 'An offering cannot be moved under one of its own variants';
  }
  const above = offeringAncestors(parentId, byId).length + 1; // the parent and its ancestors
  const below = id ? height(id, childrenOf(rows)) : 0;
  if (above + 1 + below > OFFERING_TREE_DEPTH_MAX) {
    return `The tree can have at most ${OFFERING_TREE_DEPTH_MAX} levels`;
  }
  return null;
}

/** Rows ordered parents first, each followed by its variants; `depth` 0 = a root. */
export function orderOfferingTree<T extends TreeNode>(rows: readonly T[]): { row: T; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of rows) {
    // a row whose parent is not in the list (inactive, removed) is shown as a root
    if (r.parentId && ids.has(r.parentId) && r.parentId !== r.id) {
      kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
    } else roots.push(r);
  }
  const out: { row: T; depth: number }[] = [];
  const seen = new Set<T>();
  const walk = (row: T, depth: number) => {
    if (seen.has(row)) return;
    seen.add(row);
    out.push({ row, depth });
    for (const child of kids.get(row.id ?? '') ?? []) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // a cycle that slipped in (only possible by hand in the database) must not hide rows
  for (const r of rows) walk(r, 0);
  return out;
}

/** True when at least one row sits under another one of the list. */
export const hasOfferingTree = (rows: readonly TreeNode[]): boolean => {
  const ids = new Set(rows.map((r) => r.id).filter(Boolean));
  return rows.some((r) => !!r.parentId && r.parentId !== r.id && ids.has(r.parentId));
};

const foldPhrase = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The never-say phrases that hold for `id`: its own and its ancestors' (a variant is bound by what is
 * written for the line it belongs to), each once, own first.
 */
export function effectiveGuardrails(
  id: string,
  byId: ReadonlyMap<string, TreeNode & { guardrails?: readonly string[]; parent?: GuardrailAncestor | null }>,
): string[] {
  // a line that is switched off (so missing from `byId`) still binds its variants: a database row
  // carries its ancestors' phrases in `parent`, while `byId` covers hand-made rows
  const lists: (readonly string[])[] = [byId.get(id)?.guardrails ?? []];
  let up = byId.get(id)?.parent ?? null;
  for (let depth = 0; up && depth < OFFERING_TREE_DEPTH_MAX; depth++, up = up.parent ?? null) {
    lists.push(up.guardrails ?? []);
  }
  for (const ancestor of offeringAncestors(id, byId)) lists.push(byId.get(ancestor)?.guardrails ?? []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const phrase of list) {
      const key = foldPhrase(phrase);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(phrase.trim());
    }
  }
  return out.slice(0, OFFERING_GUARDRAILS_MAX * OFFERING_TREE_DEPTH_MAX);
}

/**
 * The quality gate's rule for each offering of a catalog: price and availability as before, plus the
 * never-say phrases a variant inherits from its line (rows are the business's usable offerings).
 */
export function offeringQualityRules(
  rows: readonly (OfferingCore & { id: string })[],
  now = new Date(),
): QualityOfferingRule[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((r) => offeringQualityRule(r, now, effectiveGuardrails(r.id, byId)));
}
