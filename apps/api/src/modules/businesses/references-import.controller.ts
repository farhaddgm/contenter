import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ImportReferencesSchema,
  PreviewReferenceListSchema,
  type ImportReferencesInput,
  type PreviewReferenceListInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReferencesService } from './references.service';

/** List upload of attachments: look first, then add the ticked ones (docs/77 phase 3). */
@Controller('businesses')
export class ReferencesImportController {
  constructor(private readonly refs: ReferencesService) {}

  @BusinessScoped('business')
  @Post(':id/references/preview')
  preview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PreviewReferenceListSchema)) body: PreviewReferenceListInput,
  ) {
    return this.refs.previewList(id, body.urls);
  }

  @BusinessScoped('business')
  @Post(':id/references/import')
  import(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ImportReferencesSchema)) body: ImportReferencesInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.refs.importList(id, body, user);
  }
}
