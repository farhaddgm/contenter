import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateUserSchema,
  PaginationQuerySchema,
  SetTopicAccessSchema,
  UpdateUserSchema,
  isGmail,
  type CreateUserInput,
  type PaginationQuery,
  type SetTopicAccessInput,
  type UpdateUserInput,
  type UserTopicAccess,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { accessOf } from '../../common/topic-access';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { paginate, toPage } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery) {
    const where: Prisma.UserWhereInput = query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(query) }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(
      items.map((u) => this.auth.toPublic(u)),
      total,
      query,
    );
  }

  async create(input: CreateUserInput, actor: AuthUser) {
    const actorIsOwner = this.auth.isOwner(actor.email);
    if (this.auth.isOwner(input.email) && !actorIsOwner) {
      throw new ForbiddenException('This address is reserved for the owner');
    }
    const loginMethod = input.loginMethod ?? 'PASSWORD';
    if (loginMethod !== 'PASSWORD') {
      if (!actorIsOwner) throw new ForbiddenException('Only the owner can grant Gmail sign-in');
      if (await this.auth.findGmailUser(input.email)) {
        throw new ConflictException('A user with this Gmail address already exists');
      }
    }
    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        loginMethod,
        passwordHash:
          loginMethod === 'GOOGLE' || !input.password
            ? null
            : await this.auth.hashPassword(input.password),
      },
    });
    this.audit.log({
      userId: actor.id,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      meta: { role: user.role, loginMethod },
    });
    return this.auth.toPublic(user);
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser) {
    if (id === actor.id && ((input.role && input.role !== 'ADMIN') || input.isActive === false)) {
      throw new ForbiddenException('You cannot demote or deactivate yourself');
    }
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const actorIsOwner = this.auth.isOwner(actor.email);
    if (this.auth.isOwner(target.email) && !actorIsOwner) {
      throw new ForbiddenException('Only the owner can change the owner account');
    }
    const { password, loginMethod: requested, ...rest } = input;
    const loginMethod = requested ?? target.loginMethod;
    const methodChanged = loginMethod !== target.loginMethod;
    if (methodChanged) {
      // Every change involves Gmail sign-in on one side, which is the owner's call (docs/11).
      if (!actorIsOwner) throw new ForbiddenException('Only the owner can change sign-in methods');
      if (loginMethod !== 'PASSWORD' && !isGmail(target.email)) {
        throw new BadRequestException('Only @gmail.com addresses can sign in with Google');
      }
    }
    let passwordHash = target.passwordHash;
    if (loginMethod === 'GOOGLE') {
      if (password) {
        throw new BadRequestException('Google-only account has no password');
      }
      passwordHash = null;
    } else if (password) {
      passwordHash = await this.auth.hashPassword(password);
    } else if (!passwordHash && methodChanged) {
      throw new BadRequestException('A password is required for password sign-in');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        loginMethod,
        passwordHash,
        // Leaving Gmail sign-in unbinds the Google account so a later grant re-binds it.
        ...(loginMethod === 'PASSWORD' ? { googleSub: null } : {}),
      },
    });
    if (input.isActive === false || password || methodChanged) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.audit.log({
      userId: actor.id,
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      meta: {
        ...rest,
        ...(methodChanged ? { loginMethod } : {}),
        passwordReset: !!password,
      },
    });
    return this.auth.toPublic(user);
  }

  /** Every project with this user's access to it, for the admin's access dialog (docs/17). */
  async topicAccess(id: string): Promise<UserTopicAccess[]> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Not found');
    const topics = await this.prisma.topic.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        title: true,
        status: true,
        createdById: true,
        members: { where: { userId: id }, select: { access: true } },
      },
    });
    return topics.map((t) => {
      const granted = t.members[0]?.access ?? null;
      return {
        topicId: t.id,
        title: t.title,
        status: t.status,
        isCreator: t.createdById === id,
        granted,
        effective: accessOf(user, t, granted),
      };
    });
  }

  /** Grants VIEW/EDIT on one project, or removes the grant (null). Admins need no grants. */
  async setTopicAccess(id: string, topicId: string, input: SetTopicAccessInput, actor: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Not found');
    if (user.role === 'ADMIN') {
      throw new BadRequestException('Admins already have access to every project');
    }
    const topic = await this.prisma.topic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');
    if (input.access) {
      await this.prisma.topicMember.upsert({
        where: { topicId_userId: { topicId, userId: id } },
        create: { topicId, userId: id, access: input.access, grantedById: actor.id },
        update: { access: input.access, grantedById: actor.id },
      });
    } else {
      await this.prisma.topicMember.deleteMany({ where: { topicId, userId: id } });
    }
    this.audit.log({
      userId: actor.id,
      action: 'topic_access.set',
      entityType: 'Topic',
      entityId: topicId,
      meta: { userId: id, email: user.email, access: input.access },
    });
    return { topicId, granted: input.access, effective: accessOf(user, topic, input.access) };
  }

  /**
   * Permanently deletes a user. Their sessions and Smart conversations go with them; content
   * they created stays, with its author cleared (onDelete: SetNull).
   */
  async remove(id: string, actor: AuthUser) {
    if (id === actor.id) throw new ForbiddenException('You cannot delete yourself');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Not found');
    if (this.auth.isOwner(target.email)) {
      throw new ForbiddenException('The owner account cannot be deleted');
    }
    await this.prisma.user.delete({ where: { id } });
    this.audit.log({
      userId: actor.id,
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      meta: { email: target.email, name: target.name, role: target.role },
    });
  }
}

@Controller('admin/users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery) {
    return this.users.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.create(body, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.update(id, body, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.users.remove(id, actor);
  }

  @Get(':id/topics')
  topicAccess(@Param('id') id: string) {
    return this.users.topicAccess(id);
  }

  @Put(':id/topics/:topicId')
  setTopicAccess(
    @Param('id') id: string,
    @Param('topicId') topicId: string,
    @Body(new ZodValidationPipe(SetTopicAccessSchema)) body: SetTopicAccessInput,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.setTopicAccess(id, topicId, body, actor);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
