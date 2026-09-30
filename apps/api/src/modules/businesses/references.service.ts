import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BusinessReference as ReferenceRow, Prisma } from '@prisma/client';
import {
  AddReferenceSchema,
  BUSINESS_REFERENCE_LIMIT,
  BUSINESS_REFERENCE_MAX_CHARS,
  parseGoogleFileUrl,
  type AddReferenceInput,
  type GoogleFileType,
  type UpdateReferenceInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DriveReadError, GoogleDriveService } from '../google-drive/google-drive.service';
import { FetchError, MediaFetcherService } from '../samples/media-fetcher.service';

const ACCOUNT_REF = { select: { id: true, email: true } } as const;
const PUBLIC_EXPORT: Record<GoogleFileType, ((id: string) => string) | null> = {
  document: (id) => `https://docs.google.com/document/d/${id}/export?format=md`,
  spreadsheets: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
  presentation: (id) => `https://docs.google.com/presentation/d/${id}/export?format=txt`,
  file: null,
};

type ReferenceWithAccount = ReferenceRow & {
  googleAccount: { id: string; email: string } | null;
};

/** List shape: the (possibly long) snapshot is replaced by its length. */
const toPublic = ({ content, ...r }: ReferenceWithAccount, withContent = false) => ({
  ...r,
  chars: content.length,
  ...(withContent ? { content } : {}),
});

/**
 * References of a business (docs/14-business-references.md): links, Google Docs/Drive files and
 * pasted texts the admin supplies for AI builds and suggestions. Each is read once into a text
 * snapshot (`content`) — that snapshot, not the live page, is what AI jobs receive, so the admin
 * can inspect exactly what AI reads and refresh it on demand. Pure code, no AI.
 */
@Injectable()
export class ReferencesService {
  private readonly logger = new Logger(ReferencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fetcher: MediaFetcherService,
    private readonly drive: GoogleDriveService,
  ) {}

  async list(businessId: string) {
    const refs = await this.prisma.businessReference.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      include: { googleAccount: ACCOUNT_REF },
    });
    return refs.map((r) => toPublic(r));
  }

  async get(id: string) {
    return toPublic(await this.find(id), true);
  }

  private async find(id: string) {
    const r = await this.prisma.businessReference.findUnique({
      where: { id },
      include: { googleAccount: ACCOUNT_REF },
    });
    if (!r) throw new NotFoundException('Reference not found');
    return r;
  }

  /** Adds a link (read right away) or a pasted text. A failed read is stored, not thrown. */
  async add(businessId: string, input: AddReferenceInput, user: AuthUser) {
    const data = AddReferenceSchema.parse(input);
    const count = await this.prisma.businessReference.count({ where: { businessId } });
    if (count >= BUSINESS_REFERENCE_LIMIT) {
      throw new BadRequestException(
        `A business can have at most ${BUSINESS_REFERENCE_LIMIT} references`,
      );
    }
    let row: ReferenceRow;
    if (data.content) {
      row = await this.prisma.businessReference.create({
        data: {
          businessId,
          kind: 'TEXT',
          title: data.title,
          content: data.content,
          status: 'READY',
          fetchedAt: new Date(),
          createdById: user.id,
        },
      });
    } else {
      const url = data.url!;
      const duplicate = await this.prisma.businessReference.findFirst({
        where: { businessId, url },
      });
      if (duplicate) throw new BadRequestException('This link is already a reference');
      row = await this.prisma.businessReference.create({
        data: {
          businessId,
          kind: parseGoogleFileUrl(url) ? 'GOOGLE_DOC' : 'URL',
          url,
          title: data.title,
          createdById: user.id,
        },
      });
      await this.read(row);
    }
    this.audit.log({
      userId: user.id,
      action: 'business.reference_add',
      entityType: 'Business',
      entityId: businessId,
      meta: { referenceId: row.id, kind: row.kind, url: row.url },
    });
    return this.get(row.id).then(({ content: _content, ...rest }) => rest);
  }

  /** Reads the link again and replaces the snapshot. */
  async refresh(id: string, user: AuthUser) {
    const row = await this.find(id);
    if (row.kind === 'TEXT') throw new BadRequestException('A pasted text has nothing to refresh');
    await this.read(row);
    this.audit.log({
      userId: user.id,
      action: 'business.reference_refresh',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { referenceId: id },
    });
    return toPublic(await this.find(id));
  }

  async update(id: string, input: UpdateReferenceInput, user: AuthUser) {
    const row = await this.find(id);
    const updated = await this.prisma.businessReference.update({
      where: { id },
      data: input,
      include: { googleAccount: ACCOUNT_REF },
    });
    this.audit.log({
      userId: user.id,
      action: 'business.reference_update',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { referenceId: id, ...input },
    });
    return toPublic(updated);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    await this.prisma.businessReference.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'business.reference_remove',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { referenceId: id, kind: row.kind, url: row.url },
    });
  }

  /**
   * Checks the references an AI job is about to use (all active ones, or `ids`) and returns
   * how many are readable. Used by the service to reject a job that would have nothing to read.
   */
  async readyCount(businessId: string, ids?: string[]) {
    return this.prisma.businessReference.count({ where: usableWhere(businessId, ids) });
  }

  /** Fetches the link into the snapshot; the outcome (READY / FAILED + reason) is persisted. */
  private async read(row: ReferenceRow): Promise<void> {
    let data: Prisma.BusinessReferenceUpdateInput;
    try {
      const out =
        row.kind === 'GOOGLE_DOC' ? await this.readGoogle(row) : await this.readPage(row.url);
      const text = out.text.trim().slice(0, BUSINESS_REFERENCE_MAX_CHARS);
      if (!text) {
        throw new FetchError(
          'No readable text was found (the page may need a login or JavaScript). Paste the text instead.',
        );
      }
      data = {
        content: text,
        title: row.title || out.title.slice(0, 300),
        status: 'READY',
        error: null,
        fetchedAt: new Date(),
        googleAccount: out.accountId ? { connect: { id: out.accountId } } : { disconnect: true },
      };
    } catch (err) {
      const expected = err instanceof FetchError || err instanceof DriveReadError;
      const message = err instanceof Error ? err.message : String(err);
      if (!expected) this.logger.warn(`reference ${row.id} (${row.url}) failed: ${message}`);
      // Keep the previous snapshot: a failed refresh must not erase readable text.
      data = { status: 'FAILED', error: message.slice(0, 1000) };
    }
    await this.prisma.businessReference.update({ where: { id: row.id }, data });
  }

  private async readPage(url: string) {
    const { media } = await this.fetcher.fetch(url);
    return {
      title: media.title ?? '',
      text: media.text ?? media.description ?? '',
      accountId: null as string | null,
    };
  }

  /**
   * A link-shared ("anyone with the link") file is read without an account; a private one
   * through a connected Google account that can open it.
   */
  private async readGoogle(row: ReferenceRow) {
    const file = parseGoogleFileUrl(row.url)!;
    const pub = await this.readPublicGoogle(file).catch(() => null);
    if (pub) return { ...pub, accountId: null as string | null };
    return this.drive.readFile(file.id, row.googleAccountId);
  }

  private async readPublicGoogle(file: { id: string; type: GoogleFileType }) {
    const exportUrl = PUBLIC_EXPORT[file.type]?.(file.id);
    if (!exportUrl) return null;
    // Fixed Google host built from the file id — no user-controlled destination. A private
    // file answers with a redirect to the sign-in page, which `manual` turns into "not public"
    // (the export itself redirects once to googleusercontent.com, so follow that one hop).
    let res = await fetch(exportUrl, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      const host = new URL(next, exportUrl).hostname;
      if (!host.endsWith('.googleusercontent.com')) return null;
      res = await fetch(new URL(next, exportUrl), {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || type.includes('text/html')) return null;
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(
      res.headers.get('content-disposition') ?? '',
    )?.[1];
    return {
      title: name ? decodeURIComponent(name).replace(/\.(md|csv|txt)$/i, '') : '',
      text: await res.text(),
    };
  }
}

/** References an AI job may read: readable ones that are active, or exactly the chosen ids. */
export function usableWhere(
  businessId: string,
  ids?: string[],
): Prisma.BusinessReferenceWhereInput {
  return {
    businessId,
    status: 'READY',
    content: { not: '' },
    ...(ids ? { id: { in: ids } } : { isActive: true }),
  };
}
