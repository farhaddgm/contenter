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
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
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

  @Get('businesses/:id/notes')
  listNotes(@Param('id') id: string) {
    return this.notes.list(id);
  }

  @Post('businesses/:id/notes')
  @Roles('ADMIN', 'EDITOR')
  createNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateBusinessNoteSchema)) body: CreateBusinessNoteInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.create(id, body, user);
  }

  @Patch('business-notes/:id')
  @Roles('ADMIN', 'EDITOR')
  updateNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessNoteSchema)) body: UpdateBusinessNoteInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notes.update(id, body, user);
  }

  @Delete('business-notes/:id')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(204)
  removeNote(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.notes.remove(id, user);
  }

  // ---------- assets ----------

  @Get('businesses/:id/assets')
  listAssets(@Param('id') id: string) {
    return this.assets.list(id);
  }

  /** multipart/form-data: text fields + `file` (optional) + `previews` (0–4 images). */
  @Post('businesses/:id/assets')
  @Roles('ADMIN', 'EDITOR')
  @UseInterceptors(AssetUploadInterceptor)
  createAsset(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: AuthUser) {
    return this.assets.create(id, req.body, uploadOf(req), user);
  }

  @Get('business-assets/:id')
  asset(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @Patch('business-assets/:id')
  @Roles('ADMIN', 'EDITOR')
  updateAsset(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBusinessAssetSchema)) body: UpdateBusinessAssetInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.update(id, body, user);
  }

  @Post('business-assets/:id/analyze')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(200)
  analyzeAsset(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assets.analyze(id, user);
  }

  @Delete('business-assets/:id')
  @Roles('ADMIN', 'EDITOR')
  @HttpCode(204)
  removeAsset(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assets.remove(id, user);
  }
}
