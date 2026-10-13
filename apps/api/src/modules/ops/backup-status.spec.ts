import { describe, expect, it, vi } from 'vitest';
import type { BackupVerifyStatus } from '@contenter/shared';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { BackupStatusService } from './backup-status.service';

const passing: BackupVerifyStatus = {
  ok: true,
  checkedAt: '2026-10-18 04:07:12',
  source: 'offsite',
  backup: 'db-20261018-031700.sql.gz',
  backupAgeHours: 1,
  tables: 47,
  migrations: 31,
  uploadFiles: 12,
  rows: { User: 3, Business: 5 },
  problems: [],
  warnings: [],
};
const failing: BackupVerifyStatus = {
  ...passing,
  ok: false,
  problems: ['Table User restored but has no rows', 'Table AuditLog is missing after restore'],
};

function setup(stored: unknown = null, adminIds: string[] = ['a1', 'a2']) {
  const rows = new Map<string, unknown>();
  if (stored) rows.set('backupVerify', stored);
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null,
      ),
      upsert: vi.fn(
        async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
          rows.set(where.key, create.value);
        },
      ),
    },
  } as unknown as PrismaService;
  const notifications = {
    admins: vi.fn(async () => adminIds),
    notify: vi.fn(async () => undefined),
  } as unknown as NotificationsService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return {
    service: new BackupStatusService(prisma, notifications, audit),
    prisma,
    notifications,
    audit,
    rows,
  };
}

describe('BackupStatusService.record', () => {
  it('stores a passing result, remembers when it passed and does not warn anyone', async () => {
    const { service, notifications, audit, rows } = setup();
    const record = await service.record(passing);
    expect(record.last.ok).toBe(true);
    expect(record.lastOkAt).toBe(record.receivedAt);
    expect(rows.get('backupVerify')).toMatchObject({ last: { backup: passing.backup } });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'backup.verify_ok' }));
  });

  it('warns every active admin when the check failed, with the problems as the note', async () => {
    const { service, notifications, audit } = setup();
    await service.record(failing);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith({
      event: 'BACKUP_VERIFY_FAILED',
      recipients: ['a1', 'a2'],
      note: 'Table User restored but has no rows · Table AuditLog is missing after restore',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'backup.verify_failed',
        meta: expect.objectContaining({ problems: 2 }),
      }),
    );
  });

  it('keeps the last passing time across a later failure', async () => {
    const { service } = setup();
    const first = await service.record(passing);
    const second = await service.record(failing);
    expect(second.last.ok).toBe(false);
    expect(second.lastOkAt).toBe(first.lastOkAt);
  });

  it('still stores the result when the admins cannot be looked up', async () => {
    const { service, notifications, rows } = setup();
    vi.mocked(notifications.admins).mockRejectedValueOnce(new Error('db down'));
    const record = await service.record(failing);
    expect(record.last.ok).toBe(false);
    expect(rows.has('backupVerify')).toBe(true);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('rejects a malformed result and stores nothing', async () => {
    const { service, rows } = setup();
    await expect(service.record({ ok: 'yes' })).rejects.toThrow();
    await expect(service.record({ ...passing, source: 'cloud' })).rejects.toThrow();
    await expect(service.record({ ...passing, backupAgeHours: -1 })).rejects.toThrow();
    expect(rows.size).toBe(0);
  });
});

describe('BackupStatusService.summary (the part /api/health shows)', () => {
  it('says never before any result was reported', async () => {
    expect(await setup().service.summary()).toEqual({
      restoreCheck: 'never',
      lastRestoreVerifiedAt: null,
    });
  });

  it('says ok with the time of the last passing check', async () => {
    const { service } = setup();
    const rec = await service.record(passing);
    expect(await service.summary()).toEqual({
      restoreCheck: 'ok',
      lastRestoreVerifiedAt: rec.lastOkAt,
    });
  });

  it('says failed after a failure, but still shows when it last passed', async () => {
    const { service } = setup();
    const ok = await service.record(passing);
    await service.record(failing);
    expect(await service.summary()).toEqual({
      restoreCheck: 'failed',
      lastRestoreVerifiedAt: ok.lastOkAt,
    });
  });

  it('ignores a stored value of an unexpected shape', async () => {
    expect((await setup({ nonsense: true }).service.summary()).restoreCheck).toBe('never');
  });
});
