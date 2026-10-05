import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DocooBusinessListQuerySchema, type DocooBusinessListQuery } from '@contenter/shared';
import type { Request } from 'express';
import { Public } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DocooExportService } from './docoo-export.service';
import { IntegrationTokenGuard } from './integration-token.guard';

/**
 * Read-only service API for Docoo (docs/18-docoo-integration.md). Signed-in users and roles do
 * not apply here: the bearer `INTEGRATION_TOKEN` is the only credential, and nothing can be
 * changed through these routes.
 */
@Public()
@UseGuards(IntegrationTokenGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('integrations/docoo')
export class DocooIntegrationController {
  constructor(private readonly exports: DocooExportService) {}

  @Get('ping')
  ping() {
    return this.exports.ping();
  }

  @Get('businesses')
  list(@Query(new ZodValidationPipe(DocooBusinessListQuerySchema)) query: DocooBusinessListQuery) {
    return this.exports.list(query);
  }

  @Get('businesses/:id/export')
  export(@Param('id') id: string, @Req() req: Request) {
    return this.exports.export(id, req.ip ?? null);
  }
}
