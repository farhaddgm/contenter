import { Body, Controller, Param, Post } from '@nestjs/common';
import { TabFeedbackSchema, type TabFeedbackInput } from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { BusinessScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TabFeedbackService } from './tab-feedback.service';

@Controller()
export class TabFeedbackController {
  constructor(private readonly feedback: TabFeedbackService) {}

  @BusinessScoped('business')
  @Post('businesses/:id/tab-feedback')
  send(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TabFeedbackSchema)) body: TabFeedbackInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.send(id, body, user);
  }
}
