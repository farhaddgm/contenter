import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  CreateBusinessOfferingSchema,
  SetOfferingSegmentsSchema,
  UpdateBusinessOfferingSchema,
  type CreateBusinessOfferingInput,
  type SetOfferingSegmentsInput,
  type UpdateBusinessOfferingInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OfferingsService } from './offerings.service';

/** The catalog of what a business sells — docs/67. Reading needs VIEW, changing needs EDIT. */
@Controller()
export class OfferingsController {
  constructor(private readonly offerings: OfferingsService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/offerings')
  list(@Param('id') id: string) {
    return this.offerings.list(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/offerings')
  create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessOfferingSchema)) body: CreateBusinessOfferingInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.offerings.create(id, body, user);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/offerings/extract')
  extract(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.offerings.extract(id, user);
  }

  @BusinessScoped('businessOffering')
  @Patch('business-offerings/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessOfferingSchema)) body: UpdateBusinessOfferingInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.offerings.update(id, body, user);
  }

  /** Which audiences the offering is for (docs/73); replaces the list. */
  @BusinessScoped('businessOffering')
  @Put('business-offerings/:id/segments')
  setSegments(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetOfferingSegmentsSchema)) body: SetOfferingSegmentsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.offerings.setSegments(id, body, user);
  }

  @BusinessScoped('businessOffering')
  @Post('business-offerings/:id/confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.offerings.confirm(id, user);
  }

  @BusinessScoped('businessOffering')
  @Delete('business-offerings/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.offerings.remove(id, user);
  }
}
