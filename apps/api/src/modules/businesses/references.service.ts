import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BusinessReference as ReferenceRow, Prisma } from '@prisma/client';
import {
  AddReferenceSchema,
  BUSINESS_REFERENCE_LIMIT,
  BUSINESS_REFERENCE_MAX_CHARS,
  InstagramManualSchema,
  instagramProfileUrl,
  isGoogleDriveUrl,
  isInstagramUrl,
  isSharedHost,
  parseGoogleFileUrl,
  parseGoogleFolderUrl,
  parseInstagramHandle,
  parsePodSpaceUrl,
  type AddReferenceInput,
  type GoogleFileType,
  type InstagramPost,
  type InstagramProfile,
  type ReferenceAnalysis,
  type UpdateReferenceInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DriveReadError, GoogleDriveService } from '../google-drive/google-drive.service';
import { FetchError, MediaFetcherService } from '../samples/media-fetcher.service';
import { documentKind, extractText, isTextKind } from './document-text';
import { AssetImportService, PREVIEW_MAX_BYTES } from './asset-import.service';
import { PodSpaceService, type PodSpaceEntry } from './podspace.service';
import { analyzeInstagram, formatInstagramSnapshot } from './social/instagram-analysis';
import { InstagramService } from './social/instagram.service';
import { WebsiteCrawlerService } from './social/website-crawler.service';

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
/** Largest shared file downloaded to be read as text (PDF, Word …). */
const DOCUMENT_MAX_BYTES = 25_000_000;

/** What reading one source produced. */
interface ReadOutcome {
  title: string;
  text: string;
  accountId: string | null;
  /** INSTAGRAM / WEBSITE sources: what code computed on the way. */
  analysis?: ReferenceAnalysis;
}

/** Instagram data the admin gave by hand cannot be read again from the account. */
const isManualInstagram = (row: ReferenceRow) =>
  row.kind === 'INSTAGRAM' && (row.analysis as { provider?: string } | null)?.provider === 'MANUAL';

/** What adding or refreshing a link produced. */
interface Expansion {
  ids: string[];
  /** Files that could not be read or imported. */
  skipped: number;
  /** Images of a shared folder imported as brand assets (analyzed by AI). */
  assets?: number;
}

const isPodSpaceFolder = (url: string | null) => parsePodSpaceUrl(url ?? '')?.kind === 'folder';

/** Runs `fn` over `items`, `READ_CONCURRENCY` at a time. */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
    await Promise.all(items.slice(i, i + READ_CONCURRENCY).map(fn));
  }
}

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
    private readonly podspace: PodSpaceService,
    private readonly assets: AssetImportService,
    private readonly instagram: InstagramService,
    private readonly crawler: WebsiteCrawlerService,
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
   * Adds a pasted text, a link (read right away) or a shared folder — Google Drive or
   * PodSpace — (one reference per readable file inside; PodSpace images become brand assets).
   * A failed read is stored on the reference, not thrown. `skipped` counts folder files that
   * cannot be read.
   */
  async add(businessId: string, input: AddReferenceInput, user: AuthUser) {
    const data = AddReferenceSchema.parse(input);
    await this.assertRoom(businessId);

    let ids: string[];
    let skipped = 0;
    let assets = 0;
    if (data.instagram) {
      ids = [await this.addManualInstagram(businessId, data.instagram, user)];
    } else if (data.content) {
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
      const handle = isInstagramUrl(data.url!) ? parseInstagramHandle(data.url!) : null;
      if (isInstagramUrl(data.url!) && !handle) {
        throw new BadRequestException(
          'This Instagram link is a post, reel or story, not an account. Send the account link (instagram.com/name).',
        );
      }
      const site = !handle && data.site;
      if (site && isSharedHost(new URL(data.url!).hostname)) {
        throw new BadRequestException(
          'This is a shared platform (social network, Google Drive, blogging service), not the business website. Add it as a normal link, or use the Instagram option for an account.',
        );
      }
      const url = handle ? instagramProfileUrl(handle) : data.url!;
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
          kind: handle ? 'INSTAGRAM' : site ? 'WEBSITE' : google ? 'GOOGLE_DOC' : 'URL',
          url,
          title: data.title || (handle ? `Instagram @${handle}` : ''),
          createdById: user.id,
        },
      });
      if (isFolder) ({ ids, skipped } = await this.expandFolder(row));
      else if (isPodSpaceFolder(url)) {
        ({ ids, skipped, assets = 0 } = await this.expandPodSpace(row, user));
      } else {
        await this.read(row);
        ids = [row.id];
      }
    }
    this.audit.log({
      userId: user.id,
      action: 'business.reference_add',
      entityType: 'Business',
      entityId: businessId,
      meta: {
        references: ids.length,
        skipped,
        assets,
        url: data.url ?? null,
        ...(data.site ? { site: true } : {}),
        ...(data.instagram ? { instagram: 'manual' } : {}),
      },
    });
    return { references: await this.listByIds(ids), skipped, assets };
  }

  /** Reads the link again and replaces the snapshot (a folder link is expanded into its files). */
  async refresh(id: string, user: AuthUser) {
    const row = await this.find(id);
    if (row.kind === 'TEXT') throw new BadRequestException('A pasted text has nothing to refresh');
    if (isManualInstagram(row)) {
      throw new BadRequestException(
        'The Instagram data was given by hand, so there is nothing to read again. Delete it and add the new bio and captions.',
      );
    }
    let ids = [id];
    let skipped = 0;
    let assets = 0;
    if (parseGoogleFolderUrl(row.url)) ({ ids, skipped } = await this.expandFolder(row));
    else if (isPodSpaceFolder(row.url)) {
      ({ ids, skipped, assets = 0 } = await this.expandPodSpace(row, user));
    } else await this.read(row);
    this.audit.log({
      userId: user.id,
      action: 'business.reference_refresh',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { referenceId: id, references: ids.length, skipped, assets },
    });
    return { references: await this.listByIds(ids), skipped, assets };
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
  private async expandFolder(folderRow: ReferenceRow): Promise<Expansion> {
    const fail = (error: string) => this.failFolder(folderRow, 'GOOGLE_DOC', error);

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
    await inBatches(rows, (r) => this.read(r));
    await this.prisma.businessReference.delete({ where: { id: folderRow.id } });
    return { ids: rows.map((r) => r.id), skipped: folder.skipped.length };
  }

  /** A folder that could not be expanded stays as one FAILED reference explaining why. */
  private async failFolder(
    folderRow: ReferenceRow,
    kind: ReferenceRow['kind'],
    error: string,
    skipped = 0,
  ): Promise<Expansion> {
    await this.prisma.businessReference.update({
      where: { id: folderRow.id },
      data: { kind, status: 'FAILED', content: '', error: error.slice(0, 1000) },
    });
    return { ids: [folderRow.id], skipped };
  }

  /**
   * Turns a shared PodSpace folder (docs/14-business-references.md) into its contents, walking
   * the subfolders: text files, PDFs and Word documents become one reference each; JPEG/PNG/WebP
   * images become brand assets that AI analyzes (BUSINESS_ASSET_ANALYZE). Videos and other
   * files are counted as skipped. The folder row is removed once something was taken from it.
   */
  private async expandPodSpace(folderRow: ReferenceRow, user: AuthUser): Promise<Expansion> {
    const link = parsePodSpaceUrl(folderRow.url)!;
    let folder;
    try {
      folder = await this.podspace.listFolder(link);
    } catch (err) {
      if (!(err instanceof FetchError)) {
        this.logger.warn(`PodSpace folder ${folderRow.url} failed: ${String(err)}`);
      }
      return this.failFolder(folderRow, 'URL', err instanceof Error ? err.message : String(err));
    }

    const texts = folder.files.filter((f) => isTextKind(f.kind));
    const images = folder.files.filter((f) => f.kind === 'image');
    const unreadable = folder.files.filter((f) => !isTextKind(f.kind) && f.kind !== 'image');
    const skippedNames = unreadable.map((f) => f.path);

    const existing = await this.prisma.businessReference.findMany({
      where: { businessId: folderRow.businessId },
      select: { id: true, url: true },
    });
    const byUrl = new Map(existing.map((r) => [r.url, r.id]));
    let room = BUSINESS_REFERENCE_LIMIT - existing.length + 1;
    const rows: ReferenceRow[] = [];
    for (const file of texts) {
      const known = byUrl.get(file.url);
      if (!known && room <= 0) {
        skippedNames.push(file.path);
        continue;
      }
      if (!known) room--;
      const data = { title: file.path.slice(0, 300) };
      rows.push(
        known
          ? await this.prisma.businessReference.update({ where: { id: known }, data })
          : await this.prisma.businessReference.create({
              data: {
                ...data,
                businessId: folderRow.businessId,
                kind: 'URL',
                url: file.url,
                createdById: folderRow.createdById,
              },
            }),
      );
    }
    await inBatches(rows, (r) => this.read(r));

    let imported = 0;
    await inBatches(images, async (file) => {
      const reason = await this.importPodSpaceImage(folderRow.businessId, file, user);
      if (reason === null) imported++;
      else if (reason) skippedNames.push(`${file.path} (${reason})`);
    });

    if (!rows.length && !imported) {
      const detail = skippedNames.length
        ? ` Not read: ${skippedNames.slice(0, 8).join(', ')}${skippedNames.length > 8 ? ' …' : ''}.`
        : '';
      return this.failFolder(
        folderRow,
        'URL',
        folder.files.length
          ? `Nothing in the PodSpace folder "${folder.name}" could be read or imported.${detail} Videos go to the brand assets (upload them there, so frames are captured).`
          : `The PodSpace folder "${folder.name}" is empty.`,
        skippedNames.length,
      );
    }
    if (skippedNames.length) {
      this.logger.log(`PodSpace ${folderRow.url}: skipped ${skippedNames.join(', ')}`);
    }
    await this.prisma.businessReference.delete({ where: { id: folderRow.id } });
    return { ids: rows.map((r) => r.id), skipped: skippedNames.length, assets: imported };
  }

  /**
   * Downloads one image of a shared folder into the brand assets. Null = imported, '' = already
   * there, otherwise why it was not imported.
   */
  private async importPodSpaceImage(
    businessId: string,
    file: PodSpaceEntry,
    user: AuthUser,
  ): Promise<string | null> {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return 'GIF is not supported';
    if (file.size && file.size > PREVIEW_MAX_BYTES) return 'larger than 3 MB';
    try {
      const link = parsePodSpaceUrl(file.url)!;
      const dl = await this.podspace.download(link, PREVIEW_MAX_BYTES);
      const created = await this.assets.importImage(
        businessId,
        {
          buffer: dl.buffer,
          fileName: file.name,
          mimeType: dl.contentType.startsWith('image/') ? dl.contentType.split(';')[0]! : '',
          url: file.url,
          title: file.path.replace(/\.[^./]+$/, ''),
        },
        user,
      );
      return created ? null : '';
    } catch (err) {
      return err instanceof Error ? err.message.slice(0, 120) : String(err);
    }
  }

  /** Fetches the link into the snapshot; the outcome (READY / FAILED + reason) is persisted. */
  private async read(row: ReferenceRow): Promise<void> {
    let data: Prisma.BusinessReferenceUpdateInput;
    try {
      const out: ReadOutcome =
        row.kind === 'INSTAGRAM'
          ? await this.readInstagram(row)
          : row.kind === 'WEBSITE'
            ? await this.readWebsite(row)
            : row.kind === 'GOOGLE_DOC'
              ? await this.readGoogle(row)
              : parsePodSpaceUrl(row.url ?? '')?.kind === 'file'
                ? await this.readPodSpaceFile(row.url!)
                : await this.readPage(row.url);
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
        ...(out.analysis ? { analysis: out.analysis as unknown as Prisma.InputJsonValue } : {}),
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

  /** The public data of a Business/Creator account through the Instagram API. */
  private async readInstagram(row: ReferenceRow): Promise<ReadOutcome> {
    const handle = parseInstagramHandle(row.url);
    if (!handle) throw new FetchError('This reference does not point to an Instagram account');
    const { profile, posts } = await this.instagram.fetchAccount(handle);
    const analysis = analyzeInstagram('GRAPH', profile, posts);
    return {
      title: `Instagram @${profile.username}`,
      text: formatInstagramSnapshot({
        provider: 'GRAPH',
        profile,
        posts,
        analysis,
        readAt: new Date(),
      }),
      accountId: null,
      analysis,
    };
  }

  /** Bio, counts and captions the admin typed or took from the account's data export. */
  private async addManualInstagram(
    businessId: string,
    input: NonNullable<AddReferenceInput['instagram']>,
    user: AuthUser,
  ): Promise<string> {
    const manual = InstagramManualSchema.parse(input);
    const handle = parseInstagramHandle(manual.handle) ?? '';
    const url = handle ? instagramProfileUrl(handle) : '';
    await this.assertRoom(businessId);
    if (url && (await this.prisma.businessReference.findFirst({ where: { businessId, url } }))) {
      throw new BadRequestException(
        'This Instagram account is already a reference. Delete it first to replace it with new data.',
      );
    }
    const profile: InstagramProfile = {
      username: handle,
      name: manual.name,
      biography: manual.biography,
      website: manual.website,
      followers: manual.followers ?? null,
      following: manual.following ?? null,
      mediaCount: manual.mediaCount ?? null,
    };
    const posts: InstagramPost[] = manual.posts
      .filter((p) => p.caption)
      .map((p) => ({
        caption: p.caption,
        takenAt:
          p.takenAt && !Number.isNaN(Date.parse(p.takenAt))
            ? new Date(p.takenAt).toISOString()
            : null,
        mediaType: p.mediaType ?? 'UNKNOWN',
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        permalink: p.permalink ?? '',
      }));
    const analysis = analyzeInstagram('MANUAL', profile, posts);
    const row = await this.prisma.businessReference.create({
      data: {
        businessId,
        kind: 'INSTAGRAM',
        url,
        title: handle ? `Instagram @${handle}` : 'Instagram (given by hand)',
        content: formatInstagramSnapshot({
          provider: 'MANUAL',
          profile,
          posts,
          analysis,
          readAt: new Date(),
        }).slice(0, BUSINESS_REFERENCE_MAX_CHARS),
        analysis: analysis as unknown as Prisma.InputJsonValue,
        status: 'READY',
        fetchedAt: new Date(),
        createdById: user.id,
      },
    });
    return row.id;
  }

  /** Several pages of a website (home, about, services …), see WebsiteCrawlerService. */
  private async readWebsite(row: ReferenceRow): Promise<ReadOutcome> {
    const out = await this.crawler.read(row.url);
    return { title: out.title, text: out.text, accountId: null, analysis: out.analysis };
  }

  private async readPage(url: string): Promise<ReadOutcome> {
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

  /** One shared PodSpace file: downloaded through the API and turned into text. */
  private async readPodSpaceFile(url: string) {
    const dl = await this.podspace.download(parsePodSpaceUrl(url)!, DOCUMENT_MAX_BYTES);
    const name = dl.fileName ?? '';
    const kind = documentKind(name, dl.contentType);
    if (!isTextKind(kind)) {
      throw new FetchError(
        kind === 'image' || kind === 'video'
          ? 'This PodSpace file is an image or a video, not a text. Add it to the brand assets instead (or add its whole folder link: images are imported as assets).'
          : `This PodSpace file (${name || dl.contentType || 'unknown type'}) cannot be read as text. Readable: text, Markdown, CSV, HTML, PDF and Word (.docx).`,
      );
    }
    let text: string;
    try {
      text = await extractText(dl.buffer, kind!, dl.finalUrl);
    } catch (err) {
      throw new FetchError(
        `The file could not be read (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
    if (kind === 'pdf' && text.trim().length < 20) {
      throw new FetchError(
        'This PDF has no text layer (it is a scanned image). Paste its text instead.',
      );
    }
    return {
      title: name.replace(/\.[^.]+$/, ''),
      text,
      accountId: null as string | null,
    };
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
