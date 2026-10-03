import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  BusinessSectionKey,
  CreateBusinessFactSchema,
  CreateBusinessTermSchema,
  FixAuditIssueSchema,
  UpdateBusinessFactSchema,
  UpdateBusinessTermSchema,
  type CreateBusinessFactInput,
  type CreateBusinessTermInput,
  type FixAuditIssueInput,
  type UpdateBusinessFactInput,
  type UpdateBusinessTermInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProfileKnowledgeService } from './profile-knowledge.service';

const SectionKeyPipe = new ParseEnumPipe(Object.fromEntries(BusinessSectionKey.map((k) => [k, k])));

/** Section review, key facts, terminology and the AI profile audit — docs/16. */
@Controller()
export class ProfileKnowledgeController {
  constructor(private readonly knowledge: ProfileKnowledgeService) {}

  @BusinessScoped('business')
  @Post('businesses/:id/sections/:key/review')
  reviewSection(
    @Param('id') id: string,
    @Param('key', SectionKeyPipe) key: BusinessSectionKey,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.reviewSection(id, key, user);
  }

  // ---------- facts ----------

  @BusinessScoped('business')
  @Get('businesses/:id/facts')
  facts(@Param('id') id: string) {
    return this.knowledge.facts(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/facts')
  createFact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessFactSchema)) body: CreateBusinessFactInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.createFact(id, body, user);
  }

  @BusinessScoped('businessFact')
  @Patch('business-facts/:id')
  updateFact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessFactSchema)) body: UpdateBusinessFactInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.updateFact(id, body, user);
  }

  @BusinessScoped('businessFact')
  @Delete('business-facts/:id')
  @HttpCode(204)
  removeFact(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.knowledge.removeFact(id, user);
  }

  // ---------- terms ----------

  @BusinessScoped('business')
  @Get('businesses/:id/terms')
  terms(@Param('id') id: string) {
    return this.knowledge.terms(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/terms')
  createTerm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessTermSchema)) body: CreateBusinessTermInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.createTerm(id, body, user);
  }

  @BusinessScoped('businessTerm')
  @Patch('business-terms/:id')
  updateTerm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessTermSchema)) body: UpdateBusinessTermInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.updateTerm(id, body, user);
  }

  @BusinessScoped('businessTerm')
  @Delete('business-terms/:id')
  @HttpCode(204)
  removeTerm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.knowledge.removeTerm(id, user);
  }

  // ---------- audit ----------

  @BusinessScoped('business')
  @Get('businesses/:id/audit')
  async latestAudit(@Param('id') id: string) {
    return (await this.knowledge.latestAudit(id)) ?? null;
  }

  @BusinessScoped('business')
  @Post('businesses/:id/audit')
  startAudit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.knowledge.startAudit(id, user);
  }

  @BusinessScoped('businessAudit')
  @Post('business-audits/:id/issues/:index/fix')
  fixIssue(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body(new ZodValidationPipe(FixAuditIssueSchema)) body: FixAuditIssueInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.fixIssue(id, index, body, user);
  }

  @BusinessScoped('businessAudit')
  @Post('business-audits/:id/issues/:index/dismiss')
  dismissIssue(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.dismissIssue(id, index, user);
  }
}
