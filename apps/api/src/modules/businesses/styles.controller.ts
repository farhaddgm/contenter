import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  AddStyleSourceSchema,
  CreateBusinessStyleSchema,
  UpdateBusinessStyleSchema,
  type AddStyleSourceInput,
  type CreateBusinessStyleInput,
  type UpdateBusinessStyleInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { StylesService } from './styles.service';

/** Imitation styles built from other brands' pages — docs/64. */
@Controller()
export class StylesController {
  constructor(private readonly styles: StylesService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/styles')
  list(@Param('id') id: string) {
    return this.styles.list(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/styles')
  create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessStyleSchema)) body: CreateBusinessStyleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.styles.create(id, body, user);
  }

  @BusinessScoped('businessStyle')
  @Get('business-styles/:id')
  get(@Param('id') id: string) {
    return this.styles.get(id);
  }

  @BusinessScoped('businessStyle')
  @Patch('business-styles/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessStyleSchema)) body: UpdateBusinessStyleInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.styles.update(id, body, user);
  }

  @BusinessScoped('businessStyle')
  @Delete('business-styles/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.styles.remove(id, user);
  }

  @BusinessScoped('businessStyle')
  @Post('business-styles/:id/build')
  @HttpCode(202)
  build(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.styles.build(id, user);
  }

  @BusinessScoped('businessStyle')
  @Post('business-styles/:id/review')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.styles.review(id, user);
  }

  @BusinessScoped('businessStyle')
  @Post('business-styles/:id/sources')
  addSource(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddStyleSourceSchema)) body: AddStyleSourceInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.styles.addSource(id, body, user);
  }

  @BusinessScoped('styleSource')
  @Get('style-sources/:id')
  sourceText(@Param('id') id: string) {
    return this.styles.sourceText(id);
  }

  @BusinessScoped('styleSource')
  @Post('style-sources/:id/refresh')
  refreshSource(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.styles.refreshSource(id, user);
  }

  @BusinessScoped('styleSource')
  @Delete('style-sources/:id')
  @HttpCode(204)
  removeSource(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.styles.removeSource(id, user);
  }
}
