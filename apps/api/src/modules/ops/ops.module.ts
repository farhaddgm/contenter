import { Global, Module } from '@nestjs/common';
import { BackupStatusService } from './backup-status.service';
import { MetricsController } from './metrics.controller';
import { OpsMetricsService } from './ops-metrics.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [BackupStatusService, OpsMetricsService],
  exports: [BackupStatusService, OpsMetricsService],
})
export class OpsModule {}
