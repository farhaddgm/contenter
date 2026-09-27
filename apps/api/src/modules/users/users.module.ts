import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
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
    if (this.auth.isOwner(input.email) && !this.auth.isOwner(actor.email)) {
      throw new ForbiddenException('This address is reserved for the owner');
    }
    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        passwordHash: await this.auth.hashPassword(input.password),
      },
    });
    this.audit.log({
      userId: actor.id,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      meta: { role: user.role },
    });
    return this.auth.toPublic(user);
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser) {
    if (id === actor.id && ((input.role && input.role !== 'ADMIN') || input.isActive === false)) {
      throw new ForbiddenException('You cannot demote or deactivate yourself');
    }
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (this.auth.isOwner(target.email) && !this.auth.isOwner(actor.email)) {
      throw new ForbiddenException('Only the owner can change the owner account');
    }
    if (input.password && target.loginMethod === 'GOOGLE') {
      throw new BadRequestException(
        'Google-only account has no password (Settings → Google access)',
      );
    }
    const { password, ...rest } = input;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await this.auth.hashPassword(password) } : {}),
      },
    });
    if (input.isActive === false || password) {
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
      meta: { ...rest, passwordReset: !!password },
    });
    return this.auth.toPublic(user);
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
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
