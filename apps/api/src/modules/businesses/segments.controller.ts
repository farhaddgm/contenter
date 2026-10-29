import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateBusinessSegmentSchema,
  UpdateBusinessSegmentSchema,
  type CreateBusinessSegmentInput,
  type UpdateBusinessSegmentInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SegmentsService } from './segments.service';

/** Audiences of a business (markets and personas) — docs/73. Reading needs VIEW, changing needs EDIT. */
@Controller()
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/segments')
  list(@Param('id') id: string) {
    return this.segments.list(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/segments')
  create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessSegmentSchema)) body: CreateBusinessSegmentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.segments.create(id, body, user);
  }

  @BusinessScoped('businessSegment')
  @Patch('business-segments/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessSegmentSchema)) body: UpdateBusinessSegmentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.segments.update(id, body, user);
  }

  @BusinessScoped('businessSegment')
  @Delete('business-segments/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.segments.remove(id, user);
  }
}
