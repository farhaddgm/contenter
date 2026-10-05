import { Module } from '@nestjs/common';
import { DocooExportService } from './docoo-export.service';
import { DocooIntegrationController } from './docoo-integration.controller';

@Module({
  controllers: [DocooIntegrationController],
  providers: [DocooExportService],
})
export class IntegrationsModule {}
