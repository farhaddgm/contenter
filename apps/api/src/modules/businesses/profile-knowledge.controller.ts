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
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProfileKnowledgeService } from './profile-knowledge.service';

const SectionKeyPipe = new ParseEnumPipe(Object.fromEntries(BusinessSectionKey.map((k) => [k, k])));

/** Section review, key facts, terminology and the AI profile audit — docs/16. */
@Controller()
export class ProfileKnowledgeController {
  constructor(private readonly knowledge: ProfileKnowledgeService) {}

  @Post('businesses/:id/sections/:key/review')
  @Roles('ADMIN', 'EDITOR')
  reviewSection(
    @Param('id') id: string,
    @Param('key', SectionKeyPipe) key: BusinessSectionKey,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.reviewSection(id, key, user);
  }

  // ---------- facts ----------

  @Get('businesses/:id/facts')
  facts(@Param('id') id: string) {
    return this.knowledge.facts(id);
  }

  @Post('businesses/:id/facts')
  @Roles('ADMIN', 'EDITOR')
  createFact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessFactSchema)) body: CreateBusinessFactInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.createFact(id, body, user);
  }

  @Patch('business-facts/:id')
  @Roles('ADMIN', 'EDITOR')
  updateFact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessFactSchema)) body: UpdateBusinessFactInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.updateFact(id, body, user);
  }

  @Delete('business-facts/:id')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(204)
  removeFact(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.knowledge.removeFact(id, user);
  }

  // ---------- terms ----------

  @Get('businesses/:id/terms')
  terms(@Param('id') id: string) {
    return this.knowledge.terms(id);
  }

  @Post('businesses/:id/terms')
  @Roles('ADMIN', 'EDITOR')
  createTerm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessTermSchema)) body: CreateBusinessTermInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.createTerm(id, body, user);
  }

  @Patch('business-terms/:id')
  @Roles('ADMIN', 'EDITOR')
  updateTerm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessTermSchema)) body: UpdateBusinessTermInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.updateTerm(id, body, user);
  }

  @Delete('business-terms/:id')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(204)
  removeTerm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.knowledge.removeTerm(id, user);
  }

  // ---------- audit ----------

  @Get('businesses/:id/audit')
  async latestAudit(@Param('id') id: string) {
    return (await this.knowledge.latestAudit(id)) ?? null;
  }

  @Post('businesses/:id/audit')
  @Roles('ADMIN', 'EDITOR')
  startAudit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.knowledge.startAudit(id, user);
  }

  @Post('business-audits/:id/issues/:index/fix')
  @Roles('ADMIN', 'EDITOR')
  fixIssue(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body(new ZodValidationPipe(FixAuditIssueSchema)) body: FixAuditIssueInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.fixIssue(id, index, body, user);
  }

  @Post('business-audits/:id/issues/:index/dismiss')
  @Roles('ADMIN', 'EDITOR')
  dismissIssue(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.knowledge.dismissIssue(id, index, user);
  }
}
