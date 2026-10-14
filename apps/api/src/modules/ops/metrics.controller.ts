import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { Public } from '../../common/auth.decorators';
import { safeEqual } from '../integrations/integration-token.guard';
import { OpsMetricsService } from './ops-metrics.service';

/**
 * Guards `GET /api/metrics`: without `METRICS_TOKEN` the route does not exist (404); with it every
 * request must carry the token as a bearer token. A token equal to another service token is
 * treated as unset, so one leaked credential never opens two doors.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.env.METRICS_TOKEN;
    const shared = [this.env.INTEGRATION_TOKEN, this.env.RESEARCHER_INTEGRATION_TOKEN].some(
      (t) => !!t && !!expected && safeEqual(t, expected),
    );
    if (!expected || shared) throw new NotFoundException();
    const header: string | undefined = ctx.switchToHttp().getRequest().headers.authorization;
    const given = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!given || !safeEqual(given, expected))
      throw new UnauthorizedException('Invalid metrics token');
    return true;
  }
}

@Controller('metrics')
@Public()
@UseGuards(MetricsTokenGuard)
export class MetricsController {
  constructor(private readonly metrics: OpsMetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(): Promise<string> {
    return this.metrics.prometheus();
  }
}
