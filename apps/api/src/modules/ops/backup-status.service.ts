import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BackupVerifyStatusSchema,
  type BackupVerifyRecord,
  type BackupVerifyStatus,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const KEY = 'backupVerify';

/** What `/api/health` says about the restore check. */
export interface RestoreCheckSummary {
  /** `never`: no result was ever reported (the script is not scheduled, or the API was down). */
  restoreCheck: 'ok' | 'failed' | 'never';
  /** When the last passing check was reported (ISO), or null. */
  lastRestoreVerifiedAt: string | null;
}

/**
 * Keeps the result of the weekly backup restore check (docs/13-operations.md section 8) and warns
 * the admins when it fails. Code, not AI. The result arrives from `scripts/backup.sh verify` through
 * `apps/api/src/cli/record-backup-verify.ts`; it is never read from a request.
 */
@Injectable()
export class BackupStatusService {
  private readonly logger = new Logger(BackupStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Validates, stores and, when the check failed, notifies every active admin. */
  async record(raw: unknown): Promise<BackupVerifyRecord> {
    const status: BackupVerifyStatus = BackupVerifyStatusSchema.parse(raw);
    const previous = await this.get();
    const now = new Date().toISOString();
    const record: BackupVerifyRecord = {
      last: status,
      receivedAt: now,
      lastOkAt: status.ok ? now : (previous?.lastOkAt ?? null),
    };
    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: record as unknown as Prisma.InputJsonValue },
      update: { value: record as unknown as Prisma.InputJsonValue },
    });
    this.audit.log({
      action: status.ok ? 'backup.verify_ok' : 'backup.verify_failed',
      entityType: 'Backup',
      entityId: status.backup || null,
      meta: { source: status.source, problems: status.problems.length },
    });
    if (!status.ok) await this.warnAdmins(status);
    return record;
  }

  async get(): Promise<BackupVerifyRecord | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    const value = row?.value as Partial<BackupVerifyRecord> | undefined;
    if (!value?.last || typeof value.receivedAt !== 'string') return null;
    return {
      last: value.last,
      receivedAt: value.receivedAt,
      lastOkAt: value.lastOkAt ?? null,
    };
  }

  async summary(): Promise<RestoreCheckSummary> {
    const record = await this.get();
    return {
      restoreCheck: !record ? 'never' : record.last.ok ? 'ok' : 'failed',
      lastRestoreVerifiedAt: record?.lastOkAt ?? null,
    };
  }

  /** A failed warning must not hide the stored result, so a lookup error is only logged. */
  private async warnAdmins(status: BackupVerifyStatus): Promise<void> {
    try {
      await this.notifications.notify({
        event: 'BACKUP_VERIFY_FAILED',
        recipients: await this.notifications.admins(),
        note: status.problems.join(' · '),
      });
    } catch (err) {
      this.logger.warn(`could not warn the admins: ${(err as Error).message}`);
    }
  }
}
