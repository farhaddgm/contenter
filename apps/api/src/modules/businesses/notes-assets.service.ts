import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { BusinessAsset as AssetRow } from '@prisma/client';
import type { Request, Response } from 'express';
import multer from 'multer';
import { from, switchMap, type Observable } from 'rxjs';
import {
  ASSET_MAX_PREVIEWS,
  assetFileType,
  BUSINESS_ASSET_LIMIT,
  BUSINESS_ASSET_TEXT_MAX_CHARS,
  CreateBusinessAssetSchema,
  CreateBusinessNoteSchema,
  type CreateBusinessNoteInput,
  type UpdateBusinessAssetInput,
  type UpdateBusinessNoteInput,
} from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FileStorageService } from '../../infra/storage/file-storage.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';
import { MediaFetcherService } from '../samples/media-fetcher.service';
import { PREVIEW_MAX_BYTES } from './asset-import.service';
import { isLoginWall, ReferencesService } from './references.service';

const USER_REF = { select: { id: true, name: true } } as const;

// ─────────────────────────────── admin notes ───────────────────────────────

/**
 * Notes the admin writes about a business (docs/15-business-notes-and-assets.md). Saving a note
 * queues BUSINESS_REVISE, which brings the whole profile in line with it; active notes are also
 * given to later builds and suggestions as standing corrections.
 */
@Injectable()
export class BusinessNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly references: ReferencesService,
  ) {}

  list(businessId: string) {
    return this.prisma.businessNote.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: USER_REF },
    });
  }

  async create(businessId: string, input: CreateBusinessNoteInput, user: AuthUser) {
    const data = CreateBusinessNoteSchema.parse(input);
    const b = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!b) throw new NotFoundException('Business not found');
    if (b.buildState === 'BUILDING') {
      throw new BadRequestException('A build is running for this business; wait for it to finish');
    }
    const running = await this.prisma.businessNote.count({
      where: { businessId, status: 'PENDING' },
    });
    if (running) {
      throw new BadRequestException(
        'AI is still applying the previous note; wait for it to finish',
      );
    }
    if (data.scope === 'REFERENCES' || (data.scope === 'REFERENCE_SITES' && !b.website)) {
      if (!(await this.references.readyCount(businessId, data.referenceIds))) {
        throw new BadRequestException(
          'No readable reference: add a link, a Google Doc or a text first (or fix the failed ones).',
        );
      }
    }

    const note = await this.prisma.businessNote.create({
      data: {
        businessId,
        text: data.text,
        apply: data.apply,
        scope: data.scope,
        isActive: data.standing,
        createdById: user.id,
      },
    });
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_REVISE',
      targetType: 'Business',
      targetId: businessId,
      input: {
        noteId: note.id,
        scope: data.scope,
        referenceIds: data.referenceIds,
        apply: data.apply,
      },
      userId: user.id,
    });
    await this.prisma.businessNote.update({ where: { id: note.id }, data: { jobId: job.id } });
    this.audit.log({
      userId: user.id,
      action: 'business.note_create',
      entityType: 'Business',
      entityId: businessId,
      meta: { noteId: note.id, apply: data.apply, scope: data.scope, chars: data.text.length },
    });
    return { id: note.id, jobId: job.id };
  }

  private async find(id: string) {
    const note = await this.prisma.businessNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  async update(id: string, input: UpdateBusinessNoteInput, user: AuthUser) {
    const note = await this.find(id);
    const updated = await this.prisma.businessNote.update({
      where: { id },
      data: { isActive: input.isActive },
      include: { createdBy: USER_REF },
    });
    this.audit.log({
      userId: user.id,
      action: 'business.note_update',
      entityType: 'Business',
      entityId: note.businessId,
      meta: { noteId: id, isActive: input.isActive },
    });
    return updated;
  }

  /** Deleting a note does not undo what it changed (the section history can). */
  async remove(id: string, user: AuthUser) {
    const note = await this.find(id);
    if (note.status === 'PENDING') {
      throw new BadRequestException('AI is still applying this note');
    }
    await this.prisma.businessNote.delete({ where: { id } });
    this.audit.log({
      userId: user.id,
      action: 'business.note_delete',
      entityType: 'Business',
      entityId: note.businessId,
      meta: { noteId: id },
    });
  }
}

// ─────────────────────────────── brand assets ───────────────────────────────

export interface AssetUpload {
  file?: Express.Multer.File;
  previews: Express.Multer.File[];
}

const filesOf = (req: Request) => (req.files ?? {}) as Record<string, Express.Multer.File[]>;

const uploadedKeys = (req: Request) =>
  Object.values(filesOf(req))
    .flat()
    .map((f) => f.filename);

/** Files of a parsed multipart request, by field. */
export function uploadOf(req: Request): AssetUpload {
  const files = filesOf(req);
  return { file: files.file?.[0], previews: files.previews ?? [] };
}

/**
 * Parses the multipart upload of an asset straight to the upload directory: `file` (one image
 * or video, whitelisted extensions) and up to four JPEG/WebP/PNG `previews` made in the browser
 * (the downsized image, or frames of the video). Names on disk are server-generated keys.
 */
@Injectable()
export class AssetUploadInterceptor implements NestInterceptor {
  private readonly upload: ReturnType<ReturnType<typeof multer>['fields']>;

  constructor(
    private readonly storage: FileStorageService,
    @Inject(ENV) env: Env,
  ) {
    const engine = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
          storage.ensureRoot().then(
            (root) => cb(null, root),
            (err: Error) => cb(err, ''),
          );
        },
        filename: (_req, file, cb) => {
          const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
          cb(null, storage.newKey(file.fieldname === 'previews' ? 'jpg' : ext));
        },
      }),
      limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: ASSET_MAX_PREVIEWS + 1 },
      fileFilter: (_req, file, cb) => {
        if (file.fieldname === 'previews') {
          return cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype));
        }
        if (!assetFileType(file.originalname)) {
          return cb(
            new BadRequestException(
              'Unsupported file type. Images: jpg, png, webp, gif. Videos: mp4, webm, mov.',
            ),
          );
        }
        cb(null, true);
      },
    });
    this.upload = engine.fields([
      { name: 'file', maxCount: 1 },
      { name: 'previews', maxCount: ASSET_MAX_PREVIEWS },
    ]);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const parsed = new Promise<void>((resolve, reject) => {
      this.upload(req, http.getResponse<Response>(), (err: unknown) => {
        if (!err) return resolve();
        void this.storage.remove(uploadedKeys(req));
        if (err instanceof multer.MulterError) {
          return reject(
            err.code === 'LIMIT_FILE_SIZE'
              ? new PayloadTooLargeException('The file is larger than the upload limit')
              : new BadRequestException(err.message),
          );
        }
        reject(err);
      });
    });
    return from(parsed).pipe(switchMap(() => next.handle()));
  }
}

/**
 * Brand assets of a business: past articles, images, banners, artworks, creatives, videos and
 * motion, uploaded or linked. Each is analyzed once by BUSINESS_ASSET_ANALYZE; the analyses
 * travel with the business profile to every AI job of a linked topic.
 */
@Injectable()
export class BusinessAssetsService {
  private readonly logger = new Logger(BusinessAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly storage: FileStorageService,
    private readonly fetcher: MediaFetcherService,
  ) {}

  private toPublic(row: AssetRow, withText = false) {
    const { storageKey, previews, remoteImages, text, ...rest } = row;
    const signed = previews.map((k) => this.storage.signedUrl(k)).filter((u): u is string => !!u);
    return {
      ...rest,
      textChars: text.length,
      ...(withText ? { text } : {}),
      fileUrl: this.storage.signedUrl(storageKey),
      previewUrls: signed.length ? signed : remoteImages,
    };
  }

  async list(businessId: string) {
    const rows = await this.prisma.businessAsset.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublic(r));
  }

  private async find(id: string) {
    const row = await this.prisma.businessAsset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Asset not found');
    return row;
  }

  async get(id: string) {
    return this.toPublic(await this.find(id), true);
  }

  /** Stores the asset (its files are already on disk) and queues its analysis. */
  async create(businessId: string, body: unknown, upload: AssetUpload, user: AuthUser) {
    const uploaded = [upload.file, ...upload.previews]
      .filter((f): f is Express.Multer.File => !!f)
      .map((f) => f.filename);
    try {
      const parsed = CreateBusinessAssetSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid asset');
      }
      const data = parsed.data;
      if (!upload.file && !data.url && !data.text) {
        throw new BadRequestException('Upload a file, give a link or paste the text');
      }
      if (upload.previews.some((p) => p.size > PREVIEW_MAX_BYTES)) {
        throw new BadRequestException('A preview image is too large');
      }
      const business = await this.prisma.business.findUnique({ where: { id: businessId } });
      if (!business) throw new NotFoundException('Business not found');
      const count = await this.prisma.businessAsset.count({ where: { businessId } });
      if (count >= BUSINESS_ASSET_LIMIT) {
        throw new BadRequestException(`A business can have at most ${BUSINESS_ASSET_LIMIT} assets`);
      }

      const linked = data.url && !upload.file ? await this.readLink(data.url) : null;
      const fileTitle = upload.file?.originalname.replace(/\.[^.]+$/, '') ?? '';
      const row = await this.prisma.businessAsset.create({
        data: {
          businessId,
          kind: data.kind,
          title: (data.title || linked?.title || fileTitle).slice(0, 300),
          description: data.description,
          url: data.url,
          text: data.text || linked?.text || '',
          fileName: upload.file ? upload.file.originalname.slice(0, 300) : null,
          mimeType: upload.file?.mimetype ?? null,
          size: upload.file?.size ?? null,
          storageKey: upload.file?.filename ?? null,
          previews: upload.previews.map((p) => p.filename),
          remoteImages: linked?.images ?? [],
          analysisStatus: 'QUEUED',
          createdById: user.id,
        },
      });
      this.audit.log({
        userId: user.id,
        action: 'business.asset_create',
        entityType: 'Business',
        entityId: businessId,
        meta: { assetId: row.id, kind: row.kind, file: row.fileName, size: row.size, url: row.url },
      });
      return this.toPublic(await this.enqueue(row.id, user));
    } catch (err) {
      await this.storage.remove(uploaded);
      throw err;
    }
  }

  /** Text and cover images of a linked piece (best effort — a failed fetch is not an error). */
  private async readLink(url: string) {
    try {
      const { media } = await this.fetcher.fetch(url);
      if (isLoginWall(url, media.finalUrl ?? url)) return null;
      return {
        title: (media.title ?? '').slice(0, 300),
        text: (media.text ?? media.description ?? '').slice(0, BUSINESS_ASSET_TEXT_MAX_CHARS),
        images: media.images.filter((i) => /^https:\/\//i.test(i)).slice(0, 2),
      };
    } catch (err) {
      this.logger.warn(`asset link ${url} could not be read: ${String(err)}`);
      return null;
    }
  }

  private async enqueue(id: string, user: AuthUser) {
    const job = await this.jobs.enqueue({
      type: 'BUSINESS_ASSET_ANALYZE',
      targetType: 'BusinessAsset',
      targetId: id,
      input: {},
      userId: user.id,
    });
    return this.prisma.businessAsset.update({ where: { id }, data: { lastJobId: job.id } });
  }

  /** (Re)runs the analysis, e.g. after the description or text was edited. */
  async analyze(id: string, user: AuthUser) {
    const row = await this.find(id);
    if (row.analysisStatus === 'QUEUED') {
      throw new BadRequestException('This asset is already being analyzed');
    }
    await this.prisma.businessAsset.update({
      where: { id },
      data: { analysisStatus: 'QUEUED', analysisError: null },
    });
    return this.toPublic(await this.enqueue(id, user));
  }

  async update(id: string, input: UpdateBusinessAssetInput, user: AuthUser) {
    const row = await this.find(id);
    const updated = await this.prisma.businessAsset.update({ where: { id }, data: input });
    this.audit.log({
      userId: user.id,
      action: 'business.asset_update',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { assetId: id, ...input, text: input.text?.length },
    });
    return this.toPublic(updated, true);
  }

  async remove(id: string, user: AuthUser) {
    const row = await this.find(id);
    await this.prisma.businessAsset.delete({ where: { id } });
    await this.storage.remove([row.storageKey, ...row.previews]);
    this.audit.log({
      userId: user.id,
      action: 'business.asset_delete',
      entityType: 'Business',
      entityId: row.businessId,
      meta: { assetId: id, kind: row.kind, file: row.fileName },
    });
  }

  /** Keys of every file of a business — read before the business (and its rows) is deleted. */
  async fileKeysOf(businessId: string) {
    const rows = await this.prisma.businessAsset.findMany({
      where: { businessId },
      select: { storageKey: true, previews: true },
    });
    return rows.flatMap((r) => [r.storageKey, ...r.previews]);
  }
}
