import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiKey } from '@prisma/client';
import {
  API_KEY_MAX_ACTIVE,
  API_KEY_PREFIX,
  ApiKeyScope,
  CreateApiKeySchema,
  scopesAllowedFor,
  type ApiKeyInfo,
  type CreateApiKeyInput,
  type CreatedApiKey,
} from '@contenter/shared';
import type { ApiKeyAuth, ApiKeyAuthenticator, AuthUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const KEY_RE = /^ctk_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;
const DAY = 86_400_000;
/** Requests one key may make per minute (on top of the global per-IP limit). */
export const API_KEY_RATE_PER_MINUTE = 120;
/** `lastUsedAt` is written at most this often per key, so a busy key is not a write per request. */
const LAST_USED_EVERY_MS = 60_000;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

const toInfo = (k: ApiKey): ApiKeyInfo => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes.filter((s): s is ApiKeyScope => (ApiKeyScope as readonly string[]).includes(s)),
  createdAt: k.createdAt.toISOString(),
  expiresAt: k.expiresAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
});

/**
 * Personal API keys (docs/52-api-keys.md). The whole key is returned once at creation; only its
 * SHA-256 is stored (a key is 256 bits of randomness, so a fast hash is enough). A key speaks for
 * its owner with the owner's *current* role, narrowed by its scopes, and stops working the moment
 * the owner is deactivated, the key is revoked or it expires.
 */
@Injectable()
export class ApiKeysService implements ApiKeyAuthenticator {
  private readonly hits = new Map<string, number[]>();
  private readonly lastWrite = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<ApiKeyInfo[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInfo);
  }

  async create(user: AuthUser, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const data = CreateApiKeySchema.parse(input);
    const allowed = scopesAllowedFor(user.role);
    if (data.scopes.some((s) => !allowed.includes(s))) {
      throw new BadRequestException('This account cannot hold a key with that scope');
    }
    const now = new Date();
    const active = await this.prisma.apiKey.count({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } },
    });
    if (active >= API_KEY_MAX_ACTIVE) {
      throw new ConflictException(`At most ${API_KEY_MAX_ACTIVE} active keys; revoke one first`);
    }
    // 4 random bytes find the row (unique, retried on the rare clash); 32 random bytes are the secret
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = randomBytes(4).toString('hex');
      const key = `${API_KEY_PREFIX}${id}_${randomBytes(32).toString('base64url')}`;
      const prefix = `${API_KEY_PREFIX}${id}`;
      if (await this.prisma.apiKey.findUnique({ where: { prefix }, select: { id: true } }))
        continue;
      const row = await this.prisma.apiKey.create({
        data: {
          userId: user.id,
          name: data.name,
          prefix,
          hash: hashKey(key),
          scopes: data.scopes,
          expiresAt: new Date(now.getTime() + data.expiresInDays * DAY),
        },
      });
      // the key itself and its hash never go to the log
      this.audit.log({
        userId: user.id,
        action: 'api_key.create',
        entityType: 'ApiKey',
        entityId: row.id,
        meta: { name: row.name, prefix, scopes: data.scopes, expiresInDays: data.expiresInDays },
      });
      return { ...toInfo(row), key };
    }
    throw new ConflictException('Could not create a key; try again');
  }

  /** Revokes the caller's own key (idempotent). */
  async revoke(user: AuthUser, id: string): Promise<void> {
    const row = await this.prisma.apiKey.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new NotFoundException('Key not found');
    if (row.revokedAt) return;
    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    this.audit.log({
      userId: user.id,
      action: 'api_key.revoke',
      entityType: 'ApiKey',
      entityId: id,
      meta: { name: row.name, prefix: row.prefix },
    });
  }

  async authenticate(rawKey: string): Promise<ApiKeyAuth> {
    const fail = () => new UnauthorizedException('Invalid API key');
    const m = KEY_RE.exec(rawKey);
    if (!m) throw fail();
    const row = await this.prisma.apiKey.findUnique({
      where: { prefix: `${API_KEY_PREFIX}${m[1]}` },
      include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
    });
    // an unknown prefix costs the same comparison as a wrong secret
    const ok = safeEqualHex(hashKey(rawKey), row?.hash ?? '0'.repeat(64));
    if (!row || !ok) throw fail();
    const now = new Date();
    if (row.revokedAt || row.expiresAt <= now || !row.user.isActive) throw fail();

    this.rateLimit(row.id, now.getTime());
    this.touch(row.id, now);
    const user: AuthUser = { id: row.user.id, email: row.user.email, role: row.user.role };
    // what the owner may hold *now*: a demoted account loses the write scopes of its keys
    const allowed = scopesAllowedFor(user.role);
    const scopes = toInfo(row).scopes.filter((s) => allowed.includes(s));
    return { user, keyId: row.id, scopes };
  }

  private rateLimit(keyId: string, at: number) {
    const recent = (this.hits.get(keyId) ?? []).filter((t) => at - t < 60_000);
    if (recent.length >= API_KEY_RATE_PER_MINUTE) {
      throw new HttpException('Too many requests for this API key', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(at);
    this.hits.set(keyId, recent);
  }

  private touch(keyId: string, now: Date) {
    const last = this.lastWrite.get(keyId) ?? 0;
    if (now.getTime() - last < LAST_USED_EVERY_MS) return;
    this.lastWrite.set(keyId, now.getTime());
    // best effort: using a key never fails because the usage stamp could not be written
    void this.prisma.apiKey
      .update({ where: { id: keyId }, data: { lastUsedAt: now } })
      .catch(() => undefined);
  }
}
