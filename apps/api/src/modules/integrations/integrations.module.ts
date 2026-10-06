import { Module } from '@nestjs/common';
import { DocooExportService } from './docoo-export.service';
import { DocooIntegrationController } from './docoo-integration.controller';
import { ResearcherIntegrationController, ResearcherIntegrationGuard } from './researcher-integration';

@Module({
  controllers: [DocooIntegrationController, ResearcherIntegrationController],
  providers: [DocooExportService, ResearcherIntegrationGuard],
})
export class IntegrationsModule {}
