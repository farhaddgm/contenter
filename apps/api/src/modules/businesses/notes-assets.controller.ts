import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateBusinessNoteSchema,
  UpdateBusinessAssetSchema,
  UpdateBusinessNoteSchema,
  type CreateBusinessNoteInput,
  type UpdateBusinessAssetInput,
  type UpdateBusinessNoteInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AssetUploadInterceptor,
  BusinessAssetsService,
  BusinessNotesService,
  uploadOf,
} from './notes-assets.service';

/** Admin notes (AI revises the profile) and brand assets — docs/15-business-notes-and-assets.md. */
@Controller()
export class BusinessNotesAssetsController {
  constructor(
    private readonly notes: BusinessNotesService,
    private readonly assets: BusinessAssetsService,
  ) {}

  // ---------- notes ----------

  @BusinessScoped('business')
  @Get('businesses/:id/notes')
  listNotes(@Param('id') id: string) {
    return this.notes.list(id);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/notes')
  createNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessNoteSchema)) body: CreateBusinessNoteInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.create(id, body, user);
  }

  @BusinessScoped('businessNote')
  @Patch('business-notes/:id')
  updateNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessNoteSchema)) body: UpdateBusinessNoteInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.update(id, body, user);
  }

  @BusinessScoped('businessNote')
  @Delete('business-notes/:id')
  @HttpCode(204)
  removeNote(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.notes.remove(id, user);
  }

  // ---------- assets ----------

  @BusinessScoped('business')
  @Get('businesses/:id/assets')
  listAssets(@Param('id') id: string) {
    return this.assets.list(id);
  }

  /** multipart/form-data: text fields + `file` (optional) + `previews` (0–4 images). */
  @BusinessScoped('business')
  @Post('businesses/:id/assets')
  @UseInterceptors(AssetUploadInterceptor)
  createAsset(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: AuthUser) {
    return this.assets.create(id, req.body, uploadOf(req), user);
  }

  @BusinessScoped('businessAsset')
  @Get('business-assets/:id')
  asset(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @BusinessScoped('businessAsset')
  @Patch('business-assets/:id')
  updateAsset(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessAssetSchema)) body: UpdateBusinessAssetInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.update(id, body, user);
  }

  @BusinessScoped('businessAsset')
  @Post('business-assets/:id/analyze')
  @HttpCode(200)
  analyzeAsset(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assets.analyze(id, user);
  }

  @BusinessScoped('businessAsset')
  @Delete('business-assets/:id')
  @HttpCode(204)
  removeAsset(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assets.remove(id, user);
  }
}
