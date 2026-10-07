import {
  CanActivate, Controller, ExecutionContext, Get, Inject, Injectable,
  NotFoundException, Param, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DocooBusinessListQuerySchema, type DocooBusinessListQuery } from '@contenter/shared';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env';
import { Public } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DocooExportService } from './docoo-export.service';
import { safeEqual } from './integration-token.guard';

@Injectable()
export class ResearcherIntegrationGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.env.RESEARCHER_INTEGRATION_TOKEN;
    // Misconfiguration cannot accidentally let a Docoo token read this consumer.
    if (!expected || (this.env.INTEGRATION_TOKEN && safeEqual(expected, this.env.INTEGRATION_TOKEN))) {
      throw new NotFoundException();
    }
    const header: unknown = ctx.switchToHttp().getRequest().headers.authorization;
    const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!given || !safeEqual(given, expected)) throw new UnauthorizedException('Invalid integration token');
    return true;
  }
}

@Public()
@UseGuards(ResearcherIntegrationGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('integrations/researcher')
export class ResearcherIntegrationController {
  constructor(private readonly exports: DocooExportService, @Inject(ENV) private readonly env: Env) {}

  private allowedIds(): string[] | undefined {
    // Explicit opt-in includes future businesses without a restart or ID edit.
    return this.env.RESEARCHER_BUSINESS_ACCESS === 'all' ? undefined : this.env.RESEARCHER_BUSINESS_IDS;
  }

  @Get('ping')
  ping() { return this.exports.ping(this.allowedIds()); }

  @Get('businesses')
  list(@Query(new ZodValidationPipe(DocooBusinessListQuerySchema)) query: DocooBusinessListQuery) {
    return this.exports.list(query, this.allowedIds());
  }

  @Get('businesses/:id/export')
  export(@Param('id') id: string, @Req() req: Request) {
    const allowedIds = this.allowedIds();
    if (allowedIds && !allowedIds.includes(id)) throw new NotFoundException('Business not found');
    return this.exports.export(id, req.ip ?? null, 'researcher');
  }
}
