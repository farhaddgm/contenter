import { Global, Module } from '@nestjs/common';
import { BackupStatusService } from './backup-status.service';

@Global()
@Module({
  providers: [BackupStatusService],
  exports: [BackupStatusService],
})
export class OpsModule {}
