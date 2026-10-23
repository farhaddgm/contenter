import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateBusinessCompetitorSchema,
  UpdateBusinessCompetitorSchema,
  type CreateBusinessCompetitorInput,
  type UpdateBusinessCompetitorInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CompetitorsService } from './competitors.service';

/** Competitor cards — docs/70. Reading needs VIEW, changing needs EDIT. */
@Controller()
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/competitors')
  list(@Param('id') id: string) {
    return this.competitors.list(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/competitors')
  create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessCompetitorSchema)) body: CreateBusinessCompetitorInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.competitors.create(id, body, user);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/competitors/add-to-profile')
  addToProfile(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.competitors.addToProfile(id, user);
  }

  @BusinessScoped('businessCompetitor')
  @Patch('business-competitors/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessCompetitorSchema)) body: UpdateBusinessCompetitorInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.competitors.update(id, body, user);
  }

  @BusinessScoped('businessCompetitor')
  @Delete('business-competitors/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.competitors.remove(id, user);
  }
}
