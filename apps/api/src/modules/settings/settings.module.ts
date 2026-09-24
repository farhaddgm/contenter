import { Body, Controller, Get, Global, Inject, Injectable, Module, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AiSettingsSchema,
  type AiEffort,
  type AiJobType,
  type AiSettings,
} from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';

const AI_KEY = 'ai';

const DEFAULT_EFFORT: Record<AiJobType, AiEffort> = {
  ANALYZE_SAMPLE: 'high',
  BUILD_PROFILE: 'high',
  IDEATE: 'medium',
  GENERATE_CONTENT: 'high',
  REVISE_CONTENT: 'medium',
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  defaults(): AiSettings {
    return {
      models: { default: this.env.AI_DEFAULT_MODEL },
      effort: { ...DEFAULT_EFFORT },
      maxSamplesPerProfile: 20,
    };
  }

  async getAi(): Promise<AiSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: AI_KEY } });
    const defaults = this.defaults();
    if (!row) return defaults;
    const parsed = AiSettingsSchema.partial().safeParse(row.value);
    const stored = parsed.success ? parsed.data : {};
    return {
      models: { ...defaults.models, ...stored.models },
      effort: { ...defaults.effort, ...stored.effort },
      maxSamplesPerProfile: stored.maxSamplesPerProfile ?? defaults.maxSamplesPerProfile,
    };
  }

  async updateAi(input: AiSettings, userId: string) {
    await this.prisma.systemSetting.upsert({
      where: { key: AI_KEY },
      create: { key: AI_KEY, value: input as unknown as Prisma.InputJsonValue },
      update: { value: input as unknown as Prisma.InputJsonValue },
    });
    this.audit.log({
      userId,
      action: 'settings.update',
      entityType: 'SystemSetting',
      entityId: AI_KEY,
      meta: input as unknown as Record<string, unknown>,
    });
    return this.getAi();
  }

  async modelFor(task: AiJobType): Promise<{ model: string; effort: AiEffort }> {
    const s = await this.getAi();
    return {
      model: s.models[task] || s.models.default || this.env.AI_DEFAULT_MODEL,
      effort: s.effort[task] ?? DEFAULT_EFFORT[task],
    };
  }
}

@Controller('admin/settings')
@Roles('ADMIN')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('ai')
  async getAi() {
    return { ...(await this.settings.getAi()), provider: this.env.AI_PROVIDER };
  }

  @Put('ai')
  updateAi(
    @Body(new ZodValidationPipe(AiSettingsSchema)) body: AiSettings,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.updateAi(body, user.id);
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
