/**
 * Structured catalog of what a business sells (docs/67-business-catalog.md): products, services,
 * plans and bundles with a price (and its currency and validity), a status and a push level.
 * The `[CATALOG]` prompt block, the price check of the quality gate and the integrations' export
 * read it; AI only proposes rows (`BUSINESS_OFFERINGS_EXTRACT`) and code checks each one.
 *
 * Enums mirror `apps/api/prisma/schema.prisma`.
 */
import { z } from 'zod';
import type { SectionSource } from './business';
import { isFactExpired, normalizeTermText } from './business-profile';
import {
  comparePrice,
  extractPrices,
  normalizeDigits,
  PriceCurrency,
  type QualityOfferingRule,
} from './quality';
import { patchOf } from './schemas';
import type { OfferingSegmentLink } from './business-segments';

export const OfferingKind = ['PRODUCT', 'SERVICE', 'PLAN', 'BUNDLE'] as const;
export type OfferingKind = (typeof OfferingKind)[number];

export const OfferingStock = ['IN_STOCK', 'LOW', 'OUT'] as const;
export type OfferingStock = (typeof OfferingStock)[number];

export const OfferingStatus = ['ACTIVE', 'SEASONAL', 'PAUSED', 'DISCONTINUED'] as const;
export type OfferingStatus = (typeof OfferingStatus)[number];


export const BUSINESS_OFFERING_LIMIT = 60;
export const OFFERING_CLAIMS_MAX = 8;
export const OFFERING_RELATED_MAX = 6;
/** Outside alternatives a customer weighs against one offering (docs/74). */
export const OFFERING_ALTERNATIVES_MAX = 6;
/** Who an offering is not for (docs/74). */
export const OFFERING_NOT_FOR_MAX = 4;
/** A rival's facts older than this are told to the model as unchecked (docs/74). */
export const ALTERNATIVE_STALE_DAYS = 180;
export const OFFERING_ALIASES_MAX = 6;
export const OFFERING_FEATURES_MAX = 8;
/** Phrases an offering (and its variants) must never be described with (docs/73 §3). */
export const OFFERING_GUARDRAILS_MAX = 8;
/** Levels of the product tree: line → product → variant (docs/73). */
export const OFFERING_TREE_DEPTH_MAX = 3;
/** Total text of the `[CATALOG]` block in one prompt. */
export const MAX_CATALOG_TEXT = 6_000;
/** Push levels: 0 = do not promote · 1 = normal · 2 = priority · 3 = hero. */
export const OFFERING_PUSH_MAX = 3;

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optionalDate = z.union([isoDate, z.literal(''), z.null()]).optional();

/**
 * A price as the admin types it ("۱۹۹٬۰۰۰", "1,990,000", "12.5"): Persian digits and separators are
 * accepted, the result is a canonical decimal string. Empty = no price.
 */
export const OfferingPriceAmount = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw === null || raw === '') return null;
    const text = normalizeDigits(String(raw))
      .replace(/[\s,]/g, '')
      .replace(/^0+(?=\d)/, '');
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'Not a valid price' });
      return z.NEVER;
    }
    return text;
  });

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => u === '' || /^https?:\/\/\S+$/i.test(u), 'Only http(s) links')
  .optional()
  .default('');

/**
 * One selling point of an offering: what it has (feature), what the customer gets (benefit) and
 * what backs it (proof: a number, certificate, sample). A claim without proof is told to the model
 * as unproven, so content does not state it as certain.
 */
export const OfferingClaimSchema = z.object({
  feature: z.string().trim().min(1).max(160),
  benefit: z.string().trim().max(240).optional().default(''),
  proof: z.string().trim().max(240).optional().default(''),
});
export type OfferingClaim = z.infer<typeof OfferingClaimSchema>;

/** The stored JSON as claims; anything malformed is dropped rather than shown. */
export const parseClaims = (raw: unknown): OfferingClaim[] =>
  z.array(OfferingClaimSchema).catch([]).parse(raw);

/** Claims the model may state as certain (they have a proof). */
export const isClaimProven = (c: Pick<OfferingClaim, 'proof'>) => c.proof.trim() !== '';
/** How many claims of an offering have no proof yet. */
export const unprovenClaims = (claims: readonly Pick<OfferingClaim, 'proof'>[] | undefined) =>
  (claims ?? []).filter((c) => !isClaimProven(c)).length;

/** What a customer could choose instead of an offering: a rival, doing it themselves, or nothing. */
export const AlternativeKind = ['COMPETITOR', 'DIY', 'STATUS_QUO', 'OTHER'] as const;
export type AlternativeKind = (typeof AlternativeKind)[number];

/**
 * One outside alternative (docs/74): where we are better, where it is better (said honestly, so
 * content never bluffs), and the day a person last checked it. For positioning only — a rival's
 * name must not appear in published copy (`ALTERNATIVE_NAMED`).
 */
export const OfferingAlternativeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(AlternativeKind).optional().default('COMPETITOR'),
  ourEdge: z.string().trim().max(240).optional().default(''),
  theirEdge: z.string().trim().max(240).optional().default(''),
  checkedOn: z.union([isoDate, z.literal('')]).optional().default(''),
});
export type OfferingAlternative = z.infer<typeof OfferingAlternativeSchema>;

/** The stored JSON as alternatives; anything malformed is dropped rather than shown. */
export const parseAlternatives = (raw: unknown): OfferingAlternative[] =>
  z.array(OfferingAlternativeSchema).catch([]).parse(raw);

/**
 * Whether what we know about a rival may be out of date. Only a named competitor goes stale: doing
 * it yourself or doing nothing does not change. No check date counts as stale.
 */
export function isAlternativeStale(
  a: Pick<OfferingAlternative, 'kind' | 'checkedOn'>,
  now = new Date(),
): boolean {
  if (a.kind !== 'COMPETITOR') return false;
  if (!a.checkedOn) return true;
  const age = (now.getTime() - new Date(`${a.checkedOn}T00:00:00Z`).getTime()) / 86_400_000;
  return age > ALTERNATIVE_STALE_DAYS;
}

/** How many alternatives of an offering need a new look. */
export const staleAlternatives = (
  list: readonly Pick<OfferingAlternative, 'kind' | 'checkedOn'>[] | undefined,
  now = new Date(),
) => (list ?? []).filter((a) => isAlternativeStale(a, now)).length;

/** Names of the named rivals of an offering, for the quality check. */
export const rivalNames = (raw: unknown): string[] =>
  parseAlternatives(raw)
    .filter((a) => a.kind === 'COMPETITOR')
    .map((a) => a.name);

const BusinessOfferingBase = z.object({
  name: z.string().trim().min(1).max(120),
  /** Other spellings (Persian, Latin, short forms) that count as this offering in the quality check. */
  aliases: z
    .array(z.string().trim().min(1).max(120))
    .max(OFFERING_ALIASES_MAX)
    .optional()
    .default([]),
  kind: z.enum(OfferingKind).default('PRODUCT'),
  status: z.enum(OfferingStatus).default('ACTIVE'),
  push: z.number().int().min(0).max(OFFERING_PUSH_MAX).default(1),
  stock: z.enum(OfferingStock).default('IN_STOCK'),
  /** Persian months (1–12) when demand peaks. */
  peakMonths: z
    .array(z.number().int().min(1).max(12))
    .max(12)
    .optional()
    .default([]),
  /** The line or product this one belongs to (same business, tree of at most 3 levels); null = a root. */
  parentId: z.string().trim().min(1).max(64).nullish(),
  /** Phrases never to write about this offering or its variants ("guaranteed profit"); checked by code. */
  guardrails: z
    .array(z.string().trim().min(2).max(160))
    .max(OFFERING_GUARDRAILS_MAX)
    .optional()
    .default([]),
  /** Other offerings of this business that go well with this one / can replace it. */
  complementIds: z.array(z.string().trim().min(1).max(64)).max(OFFERING_RELATED_MAX).optional().default([]),
  substituteIds: z.array(z.string().trim().min(1).max(64)).max(OFFERING_RELATED_MAX).optional().default([]),
  summary: z.string().trim().max(400).optional().default(''),
  features: z
    .array(z.string().trim().min(1).max(160))
    .max(OFFERING_FEATURES_MAX)
    .optional()
    .default([]),
  claims: z.array(OfferingClaimSchema).max(OFFERING_CLAIMS_MAX).optional().default([]),
  /** Outside alternatives and where each stands against this offering (docs/74). */
  alternatives: z
    .array(OfferingAlternativeSchema)
    .max(OFFERING_ALTERNATIVES_MAX)
    .optional()
    .default([]),
  /** Who should not buy this ("needs a garden"); keeps content from overselling. */
  notFor: z
    .array(z.string().trim().min(2).max(160))
    .max(OFFERING_NOT_FOR_MAX)
    .optional()
    .default([]),
  priceAmount: OfferingPriceAmount,
  priceCurrency: z.enum(PriceCurrency).nullish(),
  /** The price is "from …". */
  priceFrom: z.boolean().optional().default(false),
  /** "monthly", "per session" — printed after the price. */
  priceUnit: z.string().trim().max(40).optional().default(''),
  priceValidUntil: optionalDate,
  availableFrom: optionalDate,
  availableUntil: optionalDate,
  url: optionalUrl,
  /** Internal note; never sent to a model or an integration. */
  note: z.string().trim().max(1000).optional().default(''),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});

/** Cross-field rules shared by create and update (update runs them on the merged row). */
export function offeringProblems(o: {
  priceAmount?: string | null;
  priceCurrency?: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
}): string | null {
  if (o.priceAmount && !o.priceCurrency) return 'A price needs its currency';
  if (!o.priceAmount && o.priceCurrency) return 'A currency needs a price';
  if (o.availableFrom && o.availableUntil && o.availableFrom > o.availableUntil) {
    return 'The season ends before it starts';
  }
  return null;
}

export const CreateBusinessOfferingSchema = BusinessOfferingBase.superRefine((v, ctx) => {
  const problem = offeringProblems({
    priceAmount: v.priceAmount,
    priceCurrency: v.priceCurrency,
    availableFrom: v.availableFrom || null,
    availableUntil: v.availableUntil || null,
  });
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});
export type CreateBusinessOfferingInput = z.input<typeof CreateBusinessOfferingSchema>;

export const UpdateBusinessOfferingSchema = patchOf(BusinessOfferingBase).extend({
  isActive: z.boolean().optional(),
});
export type UpdateBusinessOfferingInput = z.input<typeof UpdateBusinessOfferingSchema>;

export interface BusinessOffering {
  id: string;
  businessId: string;
  name: string;
  aliases: string[];
  kind: OfferingKind;
  status: OfferingStatus;
  push: number;
  stock: OfferingStock;
  peakMonths: number[];
  parentId: string | null;
  guardrails: string[];
  /** The audiences (markets and personas) this offering is for, strongest fit first (docs/73). */
  segments: OfferingSegmentLink[];
  complementIds: string[];
  substituteIds: string[];
  summary: string;
  features: string[];
  claims: OfferingClaim[];
  alternatives: OfferingAlternative[];
  notFor: string[];
  priceAmount: string | null;
  priceCurrency: PriceCurrency | null;
  priceFrom: boolean;
  priceUnit: string;
  priceValidUntil: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  url: string;
  note: string;
  source: SectionSource;
  /** Confirmed by a person (rows the admin types are; AI-proposed ones are not until confirmed). */
  verified: boolean;
  /** Only active rows reach a prompt, the quality check and the exports. */
  isActive: boolean;
  /** The text in a source that backs an AI-proposed row. */
  evidence: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** A decimal as text or as the database driver's decimal object (its `toString` is exact). */
export type DecimalLike = string | { toString(): string };

/** An ancestor of an offering, with only what the never-say inheritance needs (docs/73). */
export interface GuardrailAncestor {
  guardrails?: readonly string[];
  parent?: GuardrailAncestor | null;
}

/** The fields the prompt, the quality check and the export read (a database row fits). */
export interface OfferingCore {
  /** Needed to resolve `complementIds` / `substituteIds` (absent in hand-made rows). */
  id?: string;
  /** Tree position and never-say phrases (docs/73); absent in hand-made rows. */
  parentId?: string | null;
  guardrails?: string[];
  /** The line it belongs to and that line's own parent, read whether or not they are switched on (`effectiveGuardrails`). */
  parent?: GuardrailAncestor | null;
  stock?: string;
  peakMonths?: number[];
  complementIds?: string[];
  substituteIds?: string[];
  name: string;
  aliases: string[];
  kind: OfferingKind;
  status: OfferingStatus;
  push: number;
  summary: string;
  features: string[];
  /** Feature → benefit → proof triples as stored (JSON); read them with `parseClaims`. */
  claims?: unknown;
  /** Outside alternatives as stored (JSON); read them with `parseAlternatives`. */
  alternatives?: unknown;
  notFor?: string[];
  priceAmount: DecimalLike | null;
  priceCurrency: string | null;
  priceFrom: boolean;
  priceUnit: string;
  priceValidUntil: string | Date | null;
  availableFrom: string | Date | null;
  availableUntil: string | Date | null;
}

/** The price as canonical text ("199000", "12.5"), or null when there is none. */
export function priceText(amount: DecimalLike | null | undefined): string | null {
  if (amount === null || amount === undefined) return null;
  const text = String(amount).trim();
  return text === '' ? null : text;
}
const day = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Whether an offering can be sold today: not paused or discontinued, and inside its season when it
 * has one. A seasonal offering without dates counts as available.
 */
export function isOfferingAvailable(
  o: Pick<OfferingCore, 'status' | 'availableFrom' | 'availableUntil' | 'stock'>,
  now = new Date(),
): boolean {
  if (o.status === 'PAUSED' || o.status === 'DISCONTINUED' || o.stock === 'OUT') return false;
  const today = now.toISOString().slice(0, 10);
  const from = day(o.availableFrom);
  const until = day(o.availableUntil);
  if (from && today < from) return false;
  if (until && today > until) return false;
  return true;
}

/** A price that has both parts and has not run out. */
export function hasValidPrice(o: OfferingCore, now = new Date()): boolean {
  return !!priceText(o.priceAmount) && !!o.priceCurrency && !isFactExpired(o.priceValidUntil, now);
}

const CURRENCY_LABEL: Record<PriceCurrency, string> = {
  IRT: 'تومان',
  IRR: 'ریال',
  USD: 'USD',
  EUR: 'EUR',
};

/** "199,000 تومان / monthly", "from 20 USD"; Latin digits so a model copies them exactly. */
export function formatOfferingPrice(o: OfferingCore): string {
  const price = priceText(o.priceAmount);
  if (!price || !o.priceCurrency) return '';
  const [int = '', frac] = price.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = frac ? `${grouped}.${frac}` : grouped;
  return [
    o.priceFrom ? 'from' : null,
    `${amount} ${CURRENCY_LABEL[o.priceCurrency as PriceCurrency] ?? o.priceCurrency}`,
    o.priceUnit ? `/ ${o.priceUnit}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The rule the quality gate applies to one offering. */
export function offeringQualityRule(
  o: OfferingCore,
  now = new Date(),
  /** The never-say phrases of the offering and its ancestors (`effectiveGuardrails`); default = its own. */
  guardrails: readonly string[] = o.guardrails ?? [],
): QualityOfferingRule {
  return {
    ...(guardrails.length ? { guardrails } : {}),
    ...(rivalNames(o.alternatives).length ? { rivals: rivalNames(o.alternatives) } : {}),
    ...(o.id ? { id: o.id } : {}),
    ...(o.features.length ? { features: o.features } : {}),
    name: o.name,
    aliases: o.aliases,
    priceAmount: priceText(o.priceAmount),
    priceCurrency: o.priceCurrency,
    priceFrom: o.priceFrom,
    priceValidUntil: o.priceValidUntil,
    available: isOfferingAvailable(o, now),
  };
}

/** Order of the catalog in a prompt and an export: push level first, then the admin's order. */
export function compareOfferings(
  a: Pick<OfferingCore, 'push' | 'name'> & { sortOrder?: number; id?: string },
  b: Pick<OfferingCore, 'push' | 'name'> & { sortOrder?: number; id?: string },
): number {
  return (
    b.push - a.push ||
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    a.name.localeCompare(b.name) ||
    (a.id ?? '').localeCompare(b.id ?? '')
  );
}

// ─────────────────────────────── AI proposals ───────────────────────────────

/** Most rows one extraction may propose. */
export const OFFERING_EXTRACT_MAX = 40;

/**
 * Body of `POST /businesses/:id/offerings/extract`: with a `parentId` the model is asked for the
 * variants of that offering only (docs/73 §6 G); without one, for the offerings of the whole business.
 */
export const OfferingsExtractRequestSchema = z.object({
  parentId: z.string().trim().min(1).max(64).optional(),
});
export type OfferingsExtractRequest = z.infer<typeof OfferingsExtractRequestSchema>;
/** Most variants one proposal for a line may return. */
export const OFFERING_VARIANTS_EXTRACT_MAX = 12;

/** What BUSINESS_OFFERINGS_EXTRACT returns (the runner checks every row with code before saving). */
export const OfferingsExtractSchema = z.object({
  offerings: z
    .array(
      z.object({
        name: z.string().describe('The name exactly as the sources write it'),
        aliases: z.array(z.string()).describe('Other spellings the sources use for it, or []'),
        kind: z.enum(OfferingKind),
        summary: z.string().describe('One or two sentences taken from the sources, or ""'),
        features: z.array(z.string()).describe('Short features named in the sources, or []'),
        priceAmount: z
          .string()
          .describe('The price as digits, only if a source states it ("199000"); otherwise ""'),
        priceCurrency: z.enum([...PriceCurrency, 'NONE']).describe('NONE when there is no price'),
        priceFrom: z.boolean().describe('The source says "from …" / "starting at …"'),
        priceUnit: z.string().describe('"monthly", "per session" … or ""'),
        evidence: z
          .string()
          .describe('A short exact quote from a source that shows this offering (and its price)'),
      }),
    )
    .max(OFFERING_EXTRACT_MAX),
  notes: z.string().describe('Anything the sources leave unclear, or ""'),
});
export type OfferingsExtract = z.infer<typeof OfferingsExtractSchema>;

/** A row ready to be saved (inactive and unverified until the admin confirms it). */
export interface OfferingProposalRow {
  name: string;
  aliases: string[];
  kind: OfferingKind;
  summary: string;
  features: string[];
  priceAmount: string | null;
  priceCurrency: PriceCurrency | null;
  priceFrom: boolean;
  priceUnit: string;
  evidence: string;
}

export type OfferingDropReason =
  | 'NO_NAME'
  | 'NO_EVIDENCE'
  | 'NAME_NOT_IN_SOURCES'
  | 'DUPLICATE'
  | 'LIMIT';

export interface OfferingProposalResult {
  rows: OfferingProposalRow[];
  dropped: { name: string; reason: OfferingDropReason }[];
  /** Rows kept without the price the model gave, because no source quote backs it. */
  priceDropped: string[];
}

/** Text compared across sources, quotes and names: digits, letter variants and punctuation folded. */
export function foldForEvidence(text: string): string {
  return normalizeTermText(normalizeDigits(text))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const EVIDENCE_MIN_CHARS = 6;
const clip = (s: string, n: number) => s.trim().slice(0, n);

/**
 * Turns the model's proposals into rows, keeping only what the sources back (docs/67 §4.4): a row
 * needs a quote that really occurs in a source and a name the sources use; a price is kept only
 * when the quote itself states that amount in that currency (otherwise the row stays, priceless);
 * names already in the catalog or repeated are dropped. Pure: the model proposes, this decides.
 */
export function resolveOfferingProposals(args: {
  proposals: OfferingsExtract['offerings'];
  /** The source texts the model was given. */
  sources: readonly string[];
  /** Names and aliases already in the catalog. */
  existing: readonly string[];
  /** How many more rows the catalog can take. */
  room: number;
}): OfferingProposalResult {
  const corpus = args.sources.map(foldForEvidence).join(' \n ');
  const taken = new Set(args.existing.map(foldForEvidence).filter(Boolean));
  const rows: OfferingProposalRow[] = [];
  const dropped: OfferingProposalResult['dropped'] = [];
  const priceDropped: string[] = [];

  for (const p of args.proposals) {
    const name = clip(p.name, 120);
    const foldedName = foldForEvidence(name);
    const drop = (reason: OfferingDropReason) => dropped.push({ name: name || '—', reason });
    if (!foldedName) {
      drop('NO_NAME');
      continue;
    }
    const evidence = clip(p.evidence, 300);
    const foldedEvidence = foldForEvidence(evidence);
    if (foldedEvidence.length < EVIDENCE_MIN_CHARS || !corpus.includes(foldedEvidence)) {
      drop('NO_EVIDENCE');
      continue;
    }
    if (!corpus.includes(foldedName)) {
      drop('NAME_NOT_IN_SOURCES');
      continue;
    }
    const aliases = [...new Set(p.aliases.map((a) => clip(a, 120)).filter(Boolean))]
      .filter((a) => foldForEvidence(a) !== foldedName)
      .slice(0, OFFERING_ALIASES_MAX);
    const names = [foldedName, ...aliases.map(foldForEvidence)];
    if (names.some((n) => taken.has(n))) {
      drop('DUPLICATE');
      continue;
    }
    if (rows.length >= args.room) {
      drop('LIMIT');
      continue;
    }
    names.forEach((n) => taken.add(n));

    let priceAmount: string | null = null;
    let priceCurrency: PriceCurrency | null = null;
    const typed = OfferingPriceAmount.safeParse(p.priceAmount);
    if (typed.success && typed.data && p.priceCurrency !== 'NONE') {
      const amount = Number(typed.data);
      const backed = extractPrices(evidence).some(
        (found) => comparePrice({ amount, currency: p.priceCurrency }, found) === 'match',
      );
      if (backed) {
        priceAmount = typed.data;
        priceCurrency = p.priceCurrency as PriceCurrency;
      } else {
        priceDropped.push(name);
      }
    }
    rows.push({
      name,
      aliases,
      kind: p.kind,
      summary: clip(p.summary, 400),
      features: p.features
        .map((f) => clip(f, 160))
        .filter(Boolean)
        .slice(0, OFFERING_FEATURES_MAX),
      priceAmount,
      priceCurrency,
      priceFrom: priceAmount ? p.priceFrom : false,
      priceUnit: priceAmount ? clip(p.priceUnit, 40) : '',
      evidence,
    });
  }
  return { rows, dropped, priceDropped };
}

// ─────────────────────────────── seasons ───────────────────────────────

/** Months once each, in calendar order (a transform on the schema would break `patchOf`). */
export const normalizeMonths = (months: readonly number[]) => [...new Set(months)].sort((a, b) => a - b);

/** The Persian month (1 = Farvardin … 12 = Esfand) of a date, read with `Intl` (no hand-made converter). */
export function persianMonthOf(date: Date): number {
  const part = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { month: 'numeric', timeZone: 'Asia/Tehran' })
    .formatToParts(date)
    .find((p) => p.type === 'month');
  return Number(part?.value ?? 1);
}

/** The month after `month`, wrapping Esfand to Farvardin. */
export const nextPersianMonth = (month: number) => (month % 12) + 1;

/** Whether demand for the offering peaks in the Persian month of `now`. */
export const isPeakNow = (o: Pick<OfferingCore, 'peakMonths'>, now = new Date()) =>
  (o.peakMonths ?? []).includes(persianMonthOf(now));

/**
 * Offerings whose peak starts next Persian month (peak next month, not this one) — the time to plan
 * content for them. Only offerings that can be sold are listed.
 */
export function peakingSoon<T extends Pick<OfferingCore, 'peakMonths' | 'status' | 'availableFrom' | 'availableUntil' | 'stock'>>(
  offerings: readonly T[],
  now = new Date(),
): T[] {
  const current = persianMonthOf(now);
  const next = nextPersianMonth(current);
  return offerings.filter((o) => {
    const months = o.peakMonths ?? [];
    return months.includes(next) && !months.includes(current) && o.status !== 'PAUSED' && o.status !== 'DISCONTINUED' && o.stock !== 'OUT';
  });
}
