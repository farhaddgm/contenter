/**
 * The result of the weekly backup restore check (`scripts/backup.sh verify`, docs/13-operations.md
 * section 8). The script writes it to `verify-status.json` and hands the same JSON to the API
 * (`apps/api/src/cli/record-backup-verify.ts`), which stores it and warns the admins when it failed.
 */
import { z } from 'zod';

export const BackupVerifyStatusSchema = z.object({
  ok: z.boolean(),
  /** Server local time, "YYYY-MM-DD HH:MM:SS" (written by the script). */
  checkedAt: z.string().min(1).max(40),
  source: z.enum(['local', 'offsite']),
  backup: z.string().max(200),
  backupAgeHours: z.number().int().min(0).max(1_000_000),
  tables: z.number().int().min(0).max(100_000),
  migrations: z.number().int().min(0).max(100_000),
  uploadFiles: z.number().int().min(0).max(100_000_000),
  /** Row counts of the key tables, by table name. */
  rows: z.record(z.string().max(60), z.number().int().min(0)),
  problems: z.array(z.string().max(500)).max(50),
  warnings: z.array(z.string().max(500)).max(50),
});
export type BackupVerifyStatus = z.infer<typeof BackupVerifyStatusSchema>;

/** What the API keeps and what `GET /api/health` shows of it. */
export interface BackupVerifyRecord {
  /** The latest check and its verdict. */
  last: BackupVerifyStatus;
  /** When the API received it (ISO). */
  receivedAt: string;
  /** The last time a check passed (ISO), kept across later failures. */
  lastOkAt: string | null;
}
