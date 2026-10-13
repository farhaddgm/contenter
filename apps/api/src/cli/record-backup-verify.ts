/**
 * Hands the result of `scripts/backup.sh verify` to the API: stores it, and warns the admins when
 * it failed. Run by the script inside the api container, with the JSON on stdin:
 *
 *   docker compose exec -T -e APP_ROLE=api api node apps/api/dist/cli/record-backup-verify.js < verify-status.json
 *
 * No HTTP and no token: it runs where the database and the e-mail settings already are. It builds
 * only the modules it needs (no queue, no worker timers). Exit code 0 = recorded, 1 = not recorded.
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AccessModule } from '../common/access';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { AuditModule } from '../modules/audit/audit.module';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { BackupStatusService } from '../modules/ops/backup-status.service';
import { OpsModule } from '../modules/ops/ops.module';

@Module({
  imports: [ConfigModule, PrismaModule, AccessModule, AuditModule, NotificationsModule, OpsModule],
})
class RecordBackupVerifyModule {}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readStdin()) as unknown;
  const app = await NestFactory.createApplicationContext(RecordBackupVerifyModule, {
    logger: ['error', 'warn'],
  });
  try {
    const record = await app.get(BackupStatusService).record(raw);
    // e-mails and the webhook are sent in the background: wait for them before the process ends
    await app.get(NotificationsService).idle();
    console.log(
      `Recorded the restore check: ${record.last.ok ? 'passed' : 'FAILED'} (${record.last.backup || 'no backup'})`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(`Could not record the restore check: ${(err as Error).message}`);
  process.exit(1);
});
