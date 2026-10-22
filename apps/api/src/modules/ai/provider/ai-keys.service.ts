import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiProviderName } from '@contenter/shared';
import { ENV, type Env } from '../../../config/env';
import { SecretBox } from '../../../common/secret-box';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const KEY = 'ai-keys';

type Stored = Partial<Record<AiProviderName, string>>;

/**
 * Vendor API keys the admin saved in the settings page (docs/62). Sealed with SecretBox in
 * `SystemSetting`; the plain key only exists in memory of the API and worker processes, and the
 * page only ever learns whether one is set and its last four characters.
 */
@Injectable()
export class AiKeysService {
  private readonly logger = new Logger(AiKeysService.name);
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET, 'ai-keys');
  }

  private async stored(): Promise<Stored> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    const v = (row?.value ?? {}) as Stored;
    const out: Stored = {};
    for (const name of AiProviderName) if (typeof v[name] === 'string') out[name] = v[name];
    return out;
  }

  /** Plain saved keys by vendor; one that cannot be opened (encryption key changed) is skipped. */
  async load(): Promise<Partial<Record<AiProviderName, string>>> {
    const s = await this.stored();
    const out: Partial<Record<AiProviderName, string>> = {};
    for (const name of AiProviderName) {
      const sealed = s[name];
      if (!sealed) continue;
      try {
        out[name] = this.box.open(sealed);
      } catch {
        this.logger.warn(`The saved ${name} key cannot be opened (encryption key changed?)`);
      }
    }
    return out;
  }

  /** Save (string) or remove (null) one vendor's key. */
  async set(provider: AiProviderName, key: string | null, userId: string): Promise<void> {
    const next = await this.stored();
    if (key === null) delete next[provider];
    else next[provider] = this.box.seal(key);
    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    // the key itself never goes into the audit log
    this.audit.log({
      userId,
      action: 'settings.update',
      entityType: 'SystemSetting',
      entityId: KEY,
      meta: { provider, key: key === null ? 'removed' : 'set' },
    });
  }
}
