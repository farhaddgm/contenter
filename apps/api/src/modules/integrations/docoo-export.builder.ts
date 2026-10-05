import type { Prisma } from '@prisma/client';
import {
  BusinessSectionKey,
  DOCOO_EXPORT_EXCERPT_CHARS,
  DOCOO_EXPORT_SCHEMA_VERSION,
  businessHealth,
  type AuditIssue,
  type BusinessAssetAnalysis,
  type DocooBusinessExport,
} from '@contenter/shared';

/** What the export reads from the database (one query, see DocooExportService). */
export const EXPORT_INCLUDE = {
  sections: true,
  facts: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] },
  terms: { orderBy: { createdAt: 'asc' } },
  notes: { orderBy: { createdAt: 'desc' }, take: 50 },
  references: { orderBy: { createdAt: 'asc' } },
  assets: { orderBy: { createdAt: 'desc' }, take: 200 },
  audits: { where: { status: 'READY' }, orderBy: { createdAt: 'desc' }, take: 1 },
  topics: { select: { id: true, title: true, status: true }, orderBy: { updatedAt: 'desc' } },
  _count: { select: { suggestions: { where: { status: 'PENDING' } } } },
} satisfies Prisma.BusinessInclude;

export type ExportRow = Prisma.BusinessGetPayload<{ include: typeof EXPORT_INCLUDE }>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const excerpt = (text: string) => text.slice(0, DOCOO_EXPORT_EXCERPT_CHARS);

function sourcesOf(value: Prisma.JsonValue): { url: string; title: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const { url, title } = item as { url?: unknown; title?: unknown };
    return typeof url === 'string' ? [{ url, title: typeof title === 'string' ? title : '' }] : [];
  });
}

/**
 * The whole business as one JSON document for another application. Pure: the same rows give the
 * same document except for `exportedAt`, so a reader can detect change by hashing the rest.
 * Files (uploads, previews) and people (who edited what) are not part of it.
 */
export function buildDocooExport(b: ExportRow, now: Date = new Date()): DocooBusinessExport {
  const byKey = new Map(b.sections.map((s) => [s.key as string, s]));
  const sections = BusinessSectionKey.map((key) => {
    const s = byKey.get(key);
    return {
      key,
      content: s?.content ?? '',
      source: (s?.source ?? 'ADMIN') as 'ADMIN' | 'AI',
      reviewedAt: isoOrNull(s?.reviewedAt ?? null),
      updatedAt: isoOrNull(s?.updatedAt ?? null),
    };
  });

  const audit = b.audits[0] ?? null;
  const auditIssues = (Array.isArray(audit?.issues) ? audit.issues : []) as unknown as AuditIssue[];
  const open = auditIssues.filter((i) => i.status === 'OPEN');

  return {
    schemaVersion: DOCOO_EXPORT_SCHEMA_VERSION,
    exportedAt: iso(now),
    business: {
      id: b.id,
      name: b.name,
      tagline: b.tagline,
      industry: b.industry,
      website: b.website,
      location: b.location,
      language: b.language,
      status: b.status,
      origin: b.origin,
      keyword: b.keyword,
      buildState: b.buildState,
      researchedAt: isoOrNull(b.researchedAt),
      createdAt: iso(b.createdAt),
      updatedAt: iso(b.updatedAt),
      sources: sourcesOf(b.sources),
      gaps: b.gaps,
    },
    sections,
    facts: b.facts.map((f) => ({
      id: f.id,
      label: f.label,
      value: f.value,
      category: f.category,
      sourceUrl: f.sourceUrl,
      note: f.note,
      source: f.source,
      verified: f.verified,
      validUntil: isoOrNull(f.validUntil),
      isActive: f.isActive,
      updatedAt: iso(f.updatedAt),
    })),
    terms: b.terms.map((t) => ({
      id: t.id,
      term: t.term,
      kind: t.kind,
      alternatives: t.alternatives,
      note: t.note,
      isActive: t.isActive,
    })),
    notes: b.notes.map((n) => ({
      id: n.id,
      text: n.text,
      status: n.status,
      summary: n.summary,
      changedKeys: n.changedKeys,
      isActive: n.isActive,
      createdAt: iso(n.createdAt),
    })),
    references: b.references.map((r) => ({
      id: r.id,
      kind: r.kind,
      url: r.url,
      title: r.title,
      status: r.status,
      isActive: r.isActive,
      fetchedAt: isoOrNull(r.fetchedAt),
      contentChars: r.content.length,
      excerpt: excerpt(r.content),
    })),
    assets: b.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      description: a.description,
      url: a.url,
      hasFile: Boolean(a.storageKey),
      fileName: a.fileName,
      mimeType: a.mimeType,
      analysisStatus: a.analysisStatus,
      analysis: (a.analysis ?? null) as BusinessAssetAnalysis | null,
      excerpt: excerpt(a.text),
      isActive: a.isActive,
      createdAt: iso(a.createdAt),
    })),
    audit: audit
      ? {
          id: audit.id,
          score: audit.score,
          summary: audit.summary,
          strengths: audit.strengths,
          issues: auditIssues,
          createdAt: iso(audit.createdAt),
        }
      : null,
    health: businessHealth({
      sections: b.sections.map((s) => ({
        key: s.key,
        content: s.content,
        source: s.source,
        reviewedAt: s.reviewedAt,
      })),
      pendingSuggestions: b._count.suggestions,
      facts: b.facts.map((f) => ({
        verified: f.verified,
        isActive: f.isActive,
        validUntil: f.validUntil,
      })),
      terms: b.terms.filter((t) => t.isActive).length,
      assets: b.assets.length,
      gaps: b.gaps.length,
      audit: audit
        ? { open: open.length, openHigh: open.filter((i) => i.severity === 'HIGH').length }
        : null,
      now,
    }),
    pendingSuggestions: b._count.suggestions,
    topics: b.topics.map((t) => ({ id: t.id, title: t.title, status: t.status })),
  };
}
