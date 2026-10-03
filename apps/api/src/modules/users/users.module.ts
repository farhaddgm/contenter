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
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateUserSchema,
  PaginationQuerySchema,
  UpdateUserSchema,
  isGmail,
  type CreateUserInput,
  type PaginationQuery,
  type UpdateUserInput,
} from '@contenter/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
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
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
