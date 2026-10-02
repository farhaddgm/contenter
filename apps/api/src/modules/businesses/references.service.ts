import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BusinessReference as ReferenceRow, Prisma } from '@prisma/client';
import {
  AddReferenceSchema,
  BUSINESS_REFERENCE_LIMIT,
  BUSINESS_REFERENCE_MAX_CHARS,
  isGoogleDriveUrl,
  parseGoogleFileUrl,
  parseGoogleFolderUrl,
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
/** A web page with less readable text than this is a shell (login wall, JS app), not a source. */
export const MIN_PAGE_TEXT = 200;
const READ_CONCURRENCY = 4;

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
 * True when a fetch ended on a sign-in page instead of the requested one (the requested page is
 * private). Such a page must never be stored as the content of a reference.
 */
export function isLoginWall(requestedUrl: string, finalUrl: string): boolean {
  let requested: URL;
  let final: URL;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  const host = final.hostname.toLowerCase();
  if (/^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com)$/.test(host)) {
    return true;
  }
  const moved = host !== requested.hostname.toLowerCase() || final.pathname !== requested.pathname;
  return (
    moved &&
    /(^|[/._-])(login|signin|sign-in|sign_in|authwall|sso|auth)([/._?-]|$)/i.test(
      `${host}${final.pathname}`,
    )
  );
}

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

  private async listByIds(ids: string[]) {
    const refs = await this.prisma.businessReference.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      include: { googleAccount: ACCOUNT_REF },
    });
    return refs.map((r) => toPublic(r));
  }

  /**
   * Adds a pasted text, a link (read right away) or a Google Drive folder (one reference per
   * readable file inside). A failed read is stored on the reference, not thrown. `skipped`
   * counts folder files that cannot be read as text.
   */
  async add(businessId: string, input: AddReferenceInput, user: AuthUser) {
    const data = AddReferenceSchema.parse(input);
    await this.assertRoom(businessId);

    let ids: string[];
    let skipped = 0;
    if (data.content) {
      const row = await this.prisma.businessReference.create({
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
      ids = [row.id];
    } else {
      const url = data.url!;
      const google = isGoogleDriveUrl(url);
      const isFile = !!parseGoogleFileUrl(url);
      const isFolder = !!parseGoogleFolderUrl(url);
      if (google && !isFile && !isFolder) {
        // e.g. the Drive home or a search page: fetching it would only return a sign-in page.
        throw new BadRequestException(
          'This Google Drive link is neither a file nor a folder. Open the file or folder in Drive and copy its link.',
        );
      }
      const duplicate = await this.prisma.businessReference.findFirst({
        where: { businessId, url },
      });
      if (duplicate) throw new BadRequestException('This link is already a reference');
      const row = await this.prisma.businessReference.create({
        data: {
          businessId,
          kind: google ? 'GOOGLE_DOC' : 'URL',
          url,
          title: data.title,
          createdById: user.id,
        },
      });
      if (isFolder) ({ ids, skipped } = await this.expandFolder(row));
      else {
        await this.read(row);
        ids = [row.id];
      }
    }
    this.audit.log({
      userId: user.id,
      action: 'business.reference_add',
      entityType: 'Business',
      entityId: businessId,
      meta: { references: ids.length, skipped, url: data.url ?? null },
    });
    return { references: await this.listByIds(ids), skipped };
  }

  /** Reads the link again and replaces the snapshot (a folder link is expanded into its files). */
  async refresh(id: string, user: AuthUser) {
    const row = await this.find(id);
    if (row.kind === 'TEXT') throw new BadRequestException('A pasted text has nothing to refresh');
    let ids = [id];
    let skipped = 0;
    if (parseGoogleFolderUrl(row.url)) ({ ids, skipped } = await this.expandFolder(row));
    else await this.read(row);
    this.audit.log({
      userId: user.id,
      action: 'business.reference_refresh',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { referenceId: id, references: ids.length, skipped },
    });
    return { references: await this.listByIds(ids), skipped };
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

  private async assertRoom(businessId: string) {
    const count = await this.prisma.businessReference.count({ where: { businessId } });
    if (count >= BUSINESS_REFERENCE_LIMIT) {
      throw new BadRequestException(
        `A business can have at most ${BUSINESS_REFERENCE_LIMIT} references`,
      );
    }
    return BUSINESS_REFERENCE_LIMIT - count;
  }

  /**
   * Turns a folder reference into one reference per readable file of the folder (read through
   * a connected Google account). The folder row itself is removed on success; when the folder
   * cannot be listed or has nothing readable it stays as a FAILED reference explaining why.
   */
  private async expandFolder(folderRow: ReferenceRow): Promise<{ ids: string[]; skipped: number }> {
    const fail = async (error: string) => {
      await this.prisma.businessReference.update({
        where: { id: folderRow.id },
        data: { kind: 'GOOGLE_DOC', status: 'FAILED', content: '', error: error.slice(0, 1000) },
      });
      return { ids: [folderRow.id], skipped: 0 };
    };

    let folder;
    try {
      folder = await this.drive.listFolder(
        parseGoogleFolderUrl(folderRow.url)!,
        folderRow.googleAccountId,
      );
    } catch (err) {
      if (!(err instanceof DriveReadError)) {
        this.logger.warn(`folder ${folderRow.url} failed: ${String(err)}`);
      }
      return fail(err instanceof Error ? err.message : String(err));
    }
    const skippedNames = folder.skipped.map((f) => f.name);
    if (!folder.files.length) {
      return fail(
        skippedNames.length
          ? `The folder "${folder.name}" has no file that can be read as text. Not readable: ${skippedNames.slice(0, 8).join(', ')}. Convert them to Google Docs (File → Save as Google Docs) or paste their text.`
          : `The folder "${folder.name}" is empty.`,
      );
    }

    const existing = await this.prisma.businessReference.findMany({
      where: { businessId: folderRow.businessId },
      select: { id: true, url: true },
    });
    const byUrl = new Map(existing.map((r) => [r.url, r.id]));
    // The folder row is replaced by its files, so it does not count against the limit.
    let room = BUSINESS_REFERENCE_LIMIT - existing.length + 1;
    const rows: ReferenceRow[] = [];
    for (const file of folder.files) {
      const known = byUrl.get(file.url);
      if (!known && room <= 0) continue;
      if (!known) room--;
      const data = { googleAccountId: folder.accountId, title: file.name.slice(0, 300) };
      rows.push(
        known
          ? await this.prisma.businessReference.update({ where: { id: known }, data })
          : await this.prisma.businessReference.create({
              data: {
                ...data,
                businessId: folderRow.businessId,
                kind: 'GOOGLE_DOC',
                url: file.url,
                createdById: folderRow.createdById,
              },
            }),
      );
    }
    for (let i = 0; i < rows.length; i += READ_CONCURRENCY) {
      await Promise.all(rows.slice(i, i + READ_CONCURRENCY).map((r) => this.read(r)));
    }
    await this.prisma.businessReference.delete({ where: { id: folderRow.id } });
    return { ids: rows.map((r) => r.id), skipped: folder.skipped.length };
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
    if (isLoginWall(url, media.finalUrl ?? url)) {
      throw new FetchError(
        'This page requires signing in, so its content cannot be read. Paste the text instead.',
      );
    }
    const text = (media.text ?? media.description ?? '').trim();
    if (text.length < MIN_PAGE_TEXT) {
      throw new FetchError(
        `Only ${text.length} characters of readable text were found — the page probably needs a login or JavaScript. Paste the text instead.`,
      );
    }
    return { title: media.title ?? '', text, accountId: null as string | null };
  }

  /**
   * A link-shared ("anyone with the link") file is read without an account; a private one
   * through a connected Google account that can open it.
   */
  private async readGoogle(row: ReferenceRow) {
    const file = parseGoogleFileUrl(row.url);
    if (!file) throw new DriveReadError('This Google Drive link is not a file link');
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
