import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreatePromptVersionInput } from '@contenter/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { DEFAULT_PROMPTS, type PromptKey } from './defaults';
import { templateVariables } from './render';

export interface ResolvedPrompt {
  key: string;
  version: number;
  system: string;
  user: string;
}

@Injectable()
export class PromptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active DB version, falling back to the built-in default (version 0). */
  async resolve(key: PromptKey): Promise<ResolvedPrompt> {
    const active = await this.prisma.promptTemplate.findFirst({
      where: { key, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (active) return active;
    const def = DEFAULT_PROMPTS.find((p) => p.key === key);
    if (!def) throw new NotFoundException(`Unknown prompt ${key}`);
    return { key, version: 0, system: def.system, user: def.user };
  }

  async listKeys() {
    const all = await this.prisma.promptTemplate.findMany({
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    return DEFAULT_PROMPTS.map((def) => {
      const versions = all.filter((p) => p.key === def.key);
      const active = versions.find((v) => v.isActive) ?? null;
      return {
        key: def.key,
        notes: def.notes,
        variables: templateVariables(def.user),
        versions: versions.length,
        activeVersion: active?.version ?? null,
        updatedAt: versions[0]?.createdAt ?? null,
      };
    });
  }

  versions(key: string) {
    this.assertKey(key);
    return this.prisma.promptTemplate.findMany({ where: { key }, orderBy: { version: 'desc' } });
  }

  async createVersion(key: string, input: CreatePromptVersionInput, userId: string) {
    this.assertKey(key);
    const latest = await this.prisma.promptTemplate.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.activate) {
        await tx.promptTemplate.updateMany({ where: { key }, data: { isActive: false } });
      }
      return tx.promptTemplate.create({
        data: {
          key,
          version,
          system: input.system,
          user: input.user,
          notes: input.notes ?? '',
          isActive: !!input.activate,
        },
      });
    });
    this.audit.log({
      userId,
      action: 'prompt.create_version',
      entityType: 'PromptTemplate',
      entityId: created.id,
      meta: { key, version },
    });
    return created;
  }

  async activate(key: string, version: number, userId: string) {
    this.assertKey(key);
    const target = await this.prisma.promptTemplate.findUnique({
      where: { key_version: { key, version } },
    });
    if (!target) throw new NotFoundException('Prompt version not found');
    await this.prisma.$transaction([
      this.prisma.promptTemplate.updateMany({ where: { key }, data: { isActive: false } }),
      this.prisma.promptTemplate.update({ where: { id: target.id }, data: { isActive: true } }),
    ]);
    this.audit.log({
      userId,
      action: 'prompt.activate',
      entityType: 'PromptTemplate',
      entityId: target.id,
      meta: { key, version },
    });
    return { ...target, isActive: true };
  }

  private assertKey(key: string) {
    if (!DEFAULT_PROMPTS.some((p) => p.key === key))
      throw new BadRequestException(`Unknown prompt key ${key}`);
  }
}
