import { BadRequestException, Injectable } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { BUSINESS_ASSET_LIMIT, type BusinessAssetKind } from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FileStorageService } from '../../infra/storage/file-storage.service';
import { AiJobsService } from '../ai/ai-jobs.service';
import { AuditService } from '../audit/audit.service';

/** Largest picture handed to AI as vision input (an uploaded preview or an imported image). */
export const PREVIEW_MAX_BYTES = 3 * 1024 * 1024;
/** Image types AI providers accept as vision input (the file itself becomes its preview). */
const VISION_IMAGE = /\.(jpe?g|png|webp)$/i;

/**
 * Brand assets created on the server from files it read itself (images of a shared PodSpace
 * folder). Kept apart from BusinessAssetsService: ReferencesService uses this, and
 * notes-assets.service imports ReferencesService, so sharing a file would make a circular
 * import that leaves a Nest dependency undefined at startup.
 */
@Injectable()
export class AssetImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: AiJobsService,
    private readonly storage: FileStorageService,
  ) {}

  /**
   * Stores an image as an asset and queues its analysis. Only JPEG/PNG/WebP up to
   * PREVIEW_MAX_BYTES: the file itself is the picture AI sees. Returns false when an asset with
   * the same link already exists (it is left as it is).
   */
  async importImage(
    businessId: string,
    file: { buffer: Buffer; fileName: string; mimeType: string; url: string; title: string },
    user: AuthUser,
    kind: BusinessAssetKind = 'IMAGE',
  ): Promise<boolean> {
    if (!VISION_IMAGE.test(file.fileName) || file.buffer.length > PREVIEW_MAX_BYTES) {
      throw new BadRequestException('Only JPEG, PNG or WebP images up to 3 MB can be imported');
    }
    const existing = await this.prisma.businessAsset.findFirst({
      where: { businessId, url: file.url },
    });
    if (existing) return false;
    const count = await this.prisma.businessAsset.count({ where: { businessId } });
    if (count >= BUSINESS_ASSET_LIMIT) {
      throw new BadRequestException(`A business can have at most ${BUSINESS_ASSET_LIMIT} assets`);
    }
    await this.storage.ensureRoot();
    const ext = file.fileName.split('.').pop()!.toLowerCase();
    const fileKey = this.storage.newKey(ext);
    const previewKey = this.storage.newKey(ext);
    // Two copies: deleting the asset removes the file and each preview independently.
    await writeFile(this.storage.path(fileKey), file.buffer);
    await writeFile(this.storage.path(previewKey), file.buffer);
    try {
      const row = await this.prisma.businessAsset.create({
        data: {
          businessId,
          kind,
          title: file.title.slice(0, 300),
          url: file.url,
          fileName: file.fileName.slice(0, 300),
          mimeType: file.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          size: file.buffer.length,
          storageKey: fileKey,
          previews: [previewKey],
          analysisStatus: 'QUEUED',
          createdById: user.id,
        },
      });
      this.audit.log({
        userId: user.id,
        action: 'business.asset_create',
        entityType: 'Business',
        entityId: businessId,
        meta: { assetId: row.id, kind, file: row.fileName, size: row.size, url: row.url },
      });
      const job = await this.jobs.enqueue({
        type: 'BUSINESS_ASSET_ANALYZE',
        targetType: 'BusinessAsset',
        targetId: row.id,
        input: {},
        userId: user.id,
      });
      await this.prisma.businessAsset.update({
        where: { id: row.id },
        data: { lastJobId: job.id },
      });
      return true;
    } catch (err) {
      await this.storage.remove([fileKey, previewKey]);
      throw err;
    }
  }
}
