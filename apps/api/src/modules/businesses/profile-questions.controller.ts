import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  AnswerProfileQuestionSchema,
  SkipProfileQuestionSchema,
  type AnswerProfileQuestionInput,
  type SkipProfileQuestionInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProfileQuestionsService } from './profile-questions.service';

/** Questions that fill the profile's gaps — docs/72. Reading needs VIEW, answering and skipping EDIT. */
@Controller()
export class ProfileQuestionsController {
  constructor(private readonly questions: ProfileQuestionsService) {}

  @BusinessScoped('business')
  @Get('businesses/:id/questions')
  list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.questions.list(id, user);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/questions/answer')
  answer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AnswerProfileQuestionSchema)) body: AnswerProfileQuestionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.questions.answer(id, body, user);
  }

  @BusinessScoped('business')
  @Post('businesses/:id/questions/skip')
  skip(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SkipProfileQuestionSchema)) body: SkipProfileQuestionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.questions.skip(id, body.code, user);
  }

  @BusinessScoped('business')
  @Delete('businesses/:id/questions/skips')
  resetSkips(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.questions.resetSkips(id, user);
  }
}
