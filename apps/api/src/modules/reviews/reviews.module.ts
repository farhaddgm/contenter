import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateCommentSchema,
  ReviewAction,
  ReviewBodySchema,
  UpdateCommentSchema,
  type CreateCommentInput,
  type ReviewBodyInput,
  type UpdateCommentInput,
} from '@contenter/shared';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CommentsService } from './comments.service';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly comments: CommentsService,
  ) {}

  /** One step of the workflow; who may take it is decided by the shared state machine. */
  @TopicScoped('content')
  @Post('contents/:id/review/:action')
  review(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body(new ZodValidationPipe(ReviewBodySchema)) body: ReviewBodyInput,
    @CurrentUser() user: AuthUser,
  ) {
    if (!ReviewAction.includes(action as ReviewAction)) {
      throw new BadRequestException(`Unknown review action "${action}"`);
    }
    return this.reviews.act(id, action as ReviewAction, body, user);
  }

  @TopicScoped('content')
  @Get('contents/:id/comments')
  listComments(@Param('id') id: string) {
    return this.comments.list(id);
  }

  @TopicScoped('content')
  @Post('contents/:id/comments')
  createComment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateCommentSchema)) body: CreateCommentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.create(id, body, user);
  }

  @TopicScoped('comment')
  @Patch('comments/:id')
  updateComment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCommentSchema)) body: UpdateCommentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.update(id, body, user);
  }

  @TopicScoped('comment')
  @Delete('comments/:id')
  @HttpCode(204)
  removeComment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.comments.remove(id, user);
  }
}

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, CommentsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
