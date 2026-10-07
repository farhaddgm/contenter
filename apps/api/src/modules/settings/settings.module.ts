import { Body, Controller, Get, Global, Inject, Injectable, Module, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AiSettingsSchema,
  DEFAULT_WORKFLOW,
  normalizeModelRef,
  WorkflowSettingsSchema,
  type AiEffort,
  type AiJobType,
  type AiSettings,
  type AiSettingsResponse,
  type WorkflowSettings,
} from '@contenter/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { AiProviderRegistry } from '../ai/provider/provider-registry';

const AI_KEY = 'ai';
const WORKFLOW_KEY = 'workflow';

const DEFAULT_EFFORT: Record<AiJobType, AiEffort> = {
  ANALYZE_SAMPLE: 'high',
  BUILD_PROFILE: 'high',
  IDEATE: 'medium',
  GENERATE_CONTENT: 'high',
  REVISE_CONTENT: 'medium',
  SMART_CHAT: 'medium',
  BUSINESS_DISCOVER: 'medium',
  BUSINESS_BUILD: 'high',
  BUSINESS_SUGGEST: 'medium',
  BUSINESS_REVISE: 'high',
  BUSINESS_ASSET_ANALYZE: 'medium',
  BUSINESS_AUDIT: 'high',
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
      models: { default: normalizeModelRef(this.env.AI_DEFAULT_MODEL) },
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
      models: normalizeModels({ ...defaults.models, ...stored.models }),
      effort: { ...defaults.effort, ...stored.effort },
      maxSamplesPerProfile: stored.maxSamplesPerProfile ?? defaults.maxSamplesPerProfile,
    };
  }

  async updateAi(body: AiSettings, userId: string) {
    const input = { ...body, models: normalizeModels(body.models) };
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

  async getWorkflow(): Promise<WorkflowSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: WORKFLOW_KEY } });
    const parsed = WorkflowSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : { ...DEFAULT_WORKFLOW };
  }

  async updateWorkflow(body: WorkflowSettings, userId: string) {
    await this.prisma.systemSetting.upsert({
      where: { key: WORKFLOW_KEY },
      create: { key: WORKFLOW_KEY, value: body as unknown as Prisma.InputJsonValue },
      update: { value: body as unknown as Prisma.InputJsonValue },
    });
    this.audit.log({
      userId,
      action: 'settings.update',
      entityType: 'SystemSetting',
      entityId: WORKFLOW_KEY,
      meta: body as unknown as Record<string, unknown>,
    });
    return this.getWorkflow();
  }

  /** `model` is a `provider:model` reference, resolved by AiProviderRegistry. */
  async modelFor(task: AiJobType): Promise<{ model: string; effort: AiEffort }> {
    const s = await this.getAi();
    return {
      model: s.models[task] || s.models.default || normalizeModelRef(this.env.AI_DEFAULT_MODEL),
      effort: s.effort[task] ?? DEFAULT_EFFORT[task],
    };
  }
}

function normalizeModels(models: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(models).map(([k, v]) => [k, normalizeModelRef(v)]));
}

@Controller('admin/settings')
@Roles('ADMIN')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly providers: AiProviderRegistry,
  ) {}

  @Get('ai')
  async getAi(): Promise<AiSettingsResponse> {
    return this.withStatus(await this.settings.getAi());
  }

  @Put('ai')
  async updateAi(
    @Body(new ZodValidationPipe(AiSettingsSchema)) body: AiSettings,
    @CurrentUser() user: AuthUser,
  ) {
    return this.withStatus(await this.settings.updateAi(body, user.id));
  }

  @Get('workflow')
  getWorkflow() {
    return this.settings.getWorkflow();
  }

  @Put('workflow')
  updateWorkflow(
    @Body(new ZodValidationPipe(WorkflowSettingsSchema)) body: WorkflowSettings,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.updateWorkflow(body, user.id);
  }

  private async withStatus(settings: AiSettings): Promise<AiSettingsResponse> {
    return { ...settings, mock: this.providers.isMock, providers: await this.providers.status() };
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
