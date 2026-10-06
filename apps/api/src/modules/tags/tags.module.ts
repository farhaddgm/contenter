import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  CreateTagSchema,
  SetTagsSchema,
  UpdateTagSchema,
  type CreateTagInput,
  type SetTagsInput,
  type UpdateTagInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { TopicScoped } from '../../common/access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { TAG_SELECT } from './tag-select';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(topicId: string) {
    return this.prisma.tag.findMany({
      where: { topicId },
      orderBy: { name: 'asc' },
      select: { ...TAG_SELECT, _count: { select: { contents: true, ideas: true } } },
    });
  }

  async create(topicId: string, input: CreateTagInput, user: AuthUser) {
    const data = CreateTagSchema.parse(input);
    await this.assertNameFree(topicId, data.name);
    const tag = await this.prisma.tag.create({
      data: { topicId, ...data, createdById: user.id },
      select: TAG_SELECT,
    });
    this.audit.log({
      userId: user.id,
      action: 'tag.create',
      entityType: 'Tag',
      entityId: tag.id,
      meta: { topicId, name: tag.name },
    });
    return tag;
  }

  async update(id: string, input: UpdateTagInput, user: AuthUser) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found');
    if (input.name && input.name.toLowerCase() !== tag.name.toLowerCase()) {
      await this.assertNameFree(tag.topicId, input.name, id);
    }
    const updated = await this.prisma.tag.update({
      where: { id },
      data: input,
      select: TAG_SELECT,
    });
    this.audit.log({
      userId: user.id,
      action: 'tag.update',
      entityType: 'Tag',
      entityId: id,
      meta: input,
    });
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    await this.prisma.tag.delete({ where: { id } });
    this.audit.log({ userId: user.id, action: 'tag.delete', entityType: 'Tag', entityId: id });
  }

  /** Replaces the tags of a content. */
  async setContentTags(contentId: string, input: SetTagsInput, user: AuthUser) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { topicId: true },
    });
    if (!content) throw new NotFoundException('Content not found');
    const ids = await this.assertInTopic(content.topicId, input.tagIds);
    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: { tags: { set: ids.map((id) => ({ id })) } },
      select: { tags: { select: TAG_SELECT, orderBy: { name: 'asc' } } },
    });
    this.audit.log({
      userId: user.id,
      action: 'content.tags',
      entityType: 'Content',
      entityId: contentId,
      meta: { tagIds: ids },
    });
    return updated.tags;
  }

  /** Replaces the tags of an idea. */
  async setIdeaTags(ideaId: string, input: SetTagsInput, user: AuthUser) {
    const idea = await this.prisma.idea.findUnique({
      where: { id: ideaId },
      select: { topicId: true },
    });
    if (!idea) throw new NotFoundException('Idea not found');
    const ids = await this.assertInTopic(idea.topicId, input.tagIds);
    const updated = await this.prisma.idea.update({
      where: { id: ideaId },
      data: { tags: { set: ids.map((id) => ({ id })) } },
      select: { tags: { select: TAG_SELECT, orderBy: { name: 'asc' } } },
    });
    this.audit.log({
      userId: user.id,
      action: 'idea.tags',
      entityType: 'Idea',
      entityId: ideaId,
      meta: { tagIds: ids },
    });
    return updated.tags;
  }

  /** Every id must be a tag of this topic (a tag never crosses topics, so access follows the topic). */
  async assertInTopic(topicId: string, tagIds: string[]): Promise<string[]> {
    const ids = [...new Set(tagIds)];
    if (!ids.length) return ids;
    const found = await this.prisma.tag.count({ where: { id: { in: ids }, topicId } });
    if (found !== ids.length) throw new BadRequestException('A tag does not belong to this topic');
    return ids;
  }

  private async assertNameFree(topicId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.tag.findFirst({
      where: {
        topicId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A tag with this name already exists');
  }
}

@Controller()
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @TopicScoped('topic', 'topicId')
  @Get('topics/:topicId/tags')
  list(@Param('topicId') topicId: string) {
    return this.tags.list(topicId);
  }

  @TopicScoped('topic', 'topicId')
  @Post('topics/:topicId/tags')
  create(
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(CreateTagSchema)) body: CreateTagInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tags.create(topicId, body, user);
  }

  @TopicScoped('tag')
  @Patch('tags/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTagSchema)) body: UpdateTagInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tags.update(id, body, user);
  }

  @TopicScoped('tag')
  @Delete('tags/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tags.remove(id, user);
  }

  @TopicScoped('content')
  @Put('contents/:id/tags')
  setContentTags(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetTagsSchema)) body: SetTagsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tags.setContentTags(id, body, user);
  }

  @TopicScoped('idea')
  @Put('ideas/:id/tags')
  setIdeaTags(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetTagsSchema)) body: SetTagsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tags.setIdeaTags(id, body, user);
  }
}

@Module({
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
