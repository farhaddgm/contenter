import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { GoogleDriveAccount as DriveAccountRow } from '@prisma/client';
import type { GoogleDriveStatus } from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { SecretBox } from '../../common/secret-box';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { safeRedirectPath } from '../auth/google-oauth.service';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FLOW_TTL_SECONDS = 600;
const FLOW_AUDIENCE = 'google-drive-oauth';
const TIMEOUT_MS = 30_000;
const USER_REF = { select: { id: true, name: true } } as const;

/** Why connecting a Google account failed; shown on the page the admin returns to. */
export type DriveConnectError =
  | 'not_configured'
  | 'cancelled'
  | 'expired'
  | 'no_drive_permission'
  | 'no_refresh_token'
  | 'failed';

export class DriveConnectFailure extends Error {
  constructor(
    readonly code: DriveConnectError,
    message: string = code,
    /** Where to send the admin back (known once the flow cookie was verified). */
    readonly redirectTo = '/app',
  ) {
    super(message);
  }
}

/** A Drive file could not be read; the message is shown to the admin on the reference. */
export class DriveReadError extends Error {}

interface FlowState {
  state: string;
  verifier: string;
  userId: string;
  redirectTo: string;
}

export interface DriveFile {
  title: string;
  text: string;
  accountId: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** How each Drive file type is turned into text. Null = not readable as text. */
export function driveExportPlan(
  mimeType: string,
): { export: string; fallback?: string } | 'download' | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return { export: 'text/markdown', fallback: 'text/plain' };
    case 'application/vnd.google-apps.spreadsheet':
      return { export: 'text/csv' };
    case 'application/vnd.google-apps.presentation':
      return { export: 'text/plain' };
  }
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  ) {
    return 'download';
  }
  return null;
}

/**
 * "Connect Google account": an admin grants read-only Drive access once (OAuth code flow with
 * PKCE, offline access); the encrypted refresh token lets the server read private Google
 * Docs/Sheets/Slides that account can open. Uses the same OAuth client as Google sign-in.
 * See docs/14-business-references.md.
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private readonly box: SecretBox;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET, 'google-drive');
  }

  get redirectUri(): string | null {
    if (this.env.GOOGLE_DRIVE_REDIRECT_URI) return this.env.GOOGLE_DRIVE_REDIRECT_URI;
    const login = this.env.GOOGLE_REDIRECT_URI;
    if (!login || !/\/auth\/google\/callback\/?$/.test(login)) return null;
    return login.replace(/\/auth\/google\/callback\/?$/, '/google-drive/callback');
  }

  get enabled(): boolean {
    return !!(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET && this.redirectUri);
  }

  get flowMaxAgeMs() {
    return FLOW_TTL_SECONDS * 1000;
  }

  async status(): Promise<GoogleDriveStatus> {
    const accounts = await this.prisma.googleDriveAccount.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        error: true,
        lastUsedAt: true,
        createdAt: true,
        connectedBy: USER_REF,
      },
    });
    return {
      configured: this.enabled,
      redirectUri: this.redirectUri,
      accounts: accounts as unknown as GoogleDriveStatus['accounts'],
    };
  }

  // ---------- connect (OAuth) ----------

  /** Builds Google's consent URL and the signed flow cookie that the callback verifies. */
  async start(user: AuthUser, redirectTo: unknown): Promise<{ url: string; flowToken: string }> {
    if (!this.enabled) {
      throw new BadRequestException(
        'Google is not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the redirect URI',
      );
    }
    const flow: FlowState = {
      state: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(48)),
      userId: user.id,
      redirectTo: safeRedirectPath(redirectTo),
    };
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID!,
      redirect_uri: this.redirectUri!,
      response_type: 'code',
      scope: `openid email ${DRIVE_SCOPE}`,
      state: flow.state,
      code_challenge: b64url(createHash('sha256').update(flow.verifier).digest()),
      code_challenge_method: 'S256',
      // offline + consent: Google only returns a refresh token on an explicit consent.
      access_type: 'offline',
      prompt: 'consent select_account',
    });
    const flowToken = await this.jwt.signAsync(flow, {
      secret: this.env.JWT_REFRESH_SECRET,
      audience: FLOW_AUDIENCE,
      expiresIn: FLOW_TTL_SECONDS,
    });
    return { url: `${AUTH_URL}?${params}`, flowToken };
  }

  /** Validates the callback, stores the account and returns where to send the admin back. */
  async finish(
    query: { code?: string; state?: string; error?: string },
    flowToken: string | undefined,
  ): Promise<{ email: string; redirectTo: string }> {
    let flow: FlowState;
    try {
      flow = await this.jwt.verifyAsync<FlowState>(flowToken ?? '', {
        secret: this.env.JWT_REFRESH_SECRET,
        audience: FLOW_AUDIENCE,
      });
    } catch {
      throw new DriveConnectFailure('expired', 'Missing or expired OAuth flow cookie');
    }
    const fail = (code: DriveConnectError, message?: string) =>
      new DriveConnectFailure(code, message, flow.redirectTo);

    if (!this.enabled) throw fail('not_configured');
    if (query.error) throw fail('cancelled', `Google returned ${query.error}`);
    if (!query.code || !query.state || query.state !== flow.state) {
      throw fail('expired', 'OAuth state mismatch');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: this.env.GOOGLE_CLIENT_ID!,
        client_secret: this.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: this.redirectUri!,
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      throw fail('failed', `Token exchange failed: ${res.status} ${body.error ?? ''}`);
    }
    // The consent screen lets the user untick Drive access.
    if (!(body.scope ?? '').split(' ').includes(DRIVE_SCOPE)) throw fail('no_drive_permission');
    if (!body.refresh_token) throw fail('no_refresh_token');

    const info = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${body.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const who = (await info.json().catch(() => ({}))) as { sub?: string; email?: string };
    if (!info.ok || !who.sub || !who.email) {
      throw fail('failed', `userinfo failed: ${info.status}`);
    }

    const email = who.email.toLowerCase();
    const data = {
      googleSub: who.sub,
      refreshToken: this.box.seal(body.refresh_token),
      scope: body.scope ?? '',
      error: null,
      connectedById: flow.userId,
    };
    const account = await this.prisma.googleDriveAccount.upsert({
      where: { email },
      create: { email, ...data },
      update: data,
    });
    this.tokens.set(account.id, {
      token: body.access_token,
      expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    });
    this.audit.log({
      userId: flow.userId,
      action: 'google_drive.connect',
      entityType: 'GoogleDriveAccount',
      entityId: account.id,
      meta: { email },
    });
    return { email, redirectTo: flow.redirectTo };
  }

  /** Forgets the account and revokes the grant at Google (best effort). */
  async disconnect(id: string, user: AuthUser) {
    const account = await this.prisma.googleDriveAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Google account not found');
    try {
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: this.box.open(account.refreshToken) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.warn(`Revoking ${account.email} failed: ${String(err)}`);
    }
    await this.prisma.googleDriveAccount.delete({ where: { id } });
    this.tokens.delete(id);
    this.audit.log({
      userId: user.id,
      action: 'google_drive.disconnect',
      entityType: 'GoogleDriveAccount',
      entityId: id,
      meta: { email: account.email },
    });
  }

  // ---------- reading files ----------

  /**
   * Reads a Drive file as text with the first connected account that can open it
   * (`preferredAccountId` first). Throws DriveReadError with an admin-readable reason.
   */
  async readFile(fileId: string, preferredAccountId?: string | null): Promise<DriveFile> {
    const accounts = await this.prisma.googleDriveAccount.findMany({
      orderBy: { createdAt: 'asc' },
    });
    if (!accounts.length) {
      throw new DriveReadError(
        'This Google file is private and no Google account is connected. Connect the account that can open it (Settings → Google Drive), or paste the text instead.',
      );
    }
    accounts.sort(
      (a, b) => Number(b.id === preferredAccountId) - Number(a.id === preferredAccountId),
    );
    const denied: string[] = [];
    let lastError: DriveReadError | null = null;
    for (const account of accounts) {
      try {
        const file = await this.readWith(account, fileId);
        await this.prisma.googleDriveAccount.update({
          where: { id: account.id },
          data: { lastUsedAt: new Date(), error: null },
        });
        return { ...file, accountId: account.id };
      } catch (err) {
        if (err instanceof NoAccess) denied.push(account.email);
        else if (err instanceof DriveReadError) lastError = err;
        else throw err;
      }
    }
    if (denied.length) {
      throw new DriveReadError(
        `The file was not found or is not shared with the connected Google account(s): ${denied.join(', ')}. Connect the account that can open it.`,
      );
    }
    throw lastError ?? new DriveReadError('The Google file could not be read');
  }

  private async readWith(account: DriveAccountRow, fileId: string) {
    const token = await this.accessToken(account);
    const auth = { authorization: `Bearer ${token}` };
    const id = encodeURIComponent(fileId);

    const metaRes = await fetch(`${DRIVE_URL}/${id}?fields=name,mimeType&supportsAllDrives=true`, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (metaRes.status === 404) throw new NoAccess();
    if (!metaRes.ok) throw await this.apiError(metaRes, account);
    const meta = (await metaRes.json()) as { name?: string; mimeType?: string };

    const plan = driveExportPlan(meta.mimeType ?? '');
    if (!plan) {
      throw new DriveReadError(
        `"${meta.name ?? fileId}" is a ${meta.mimeType ?? 'binary'} file, which cannot be read as text. Open it with Google Docs (File → Save as Google Docs) and add that document's link, or paste its text.`,
      );
    }
    const read = async (mime: string | null) => {
      const url = mime
        ? `${DRIVE_URL}/${id}/export?mimeType=${encodeURIComponent(mime)}`
        : `${DRIVE_URL}/${id}?alt=media&supportsAllDrives=true`;
      return fetch(url, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
    };
    let res = await read(plan === 'download' ? null : plan.export);
    if (!res.ok && plan !== 'download' && plan.fallback) res = await read(plan.fallback);
    if (!res.ok) throw await this.apiError(res, account);
    return { title: meta.name ?? '', text: await res.text() };
  }

  private async apiError(res: Response, account: DriveAccountRow): Promise<DriveReadError> {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    const message = body.error?.message ?? `HTTP ${res.status}`;
    if (
      reason === 'accessNotConfigured' ||
      /has not been used in project|is disabled/.test(message)
    ) {
      return new DriveReadError(
        'The Google Drive API is not enabled for the Google Cloud project of this OAuth client. Enable "Google Drive API" in Google Cloud Console and try again.',
      );
    }
    if (reason === 'exportSizeLimitExceeded') {
      return new DriveReadError('The document is too large for Google to export (over 10 MB).');
    }
    if (res.status === 401 || res.status === 403) {
      this.tokens.delete(account.id);
      if (res.status === 403) return new NoAccess();
    }
    return new DriveReadError(`Google Drive (${account.email}): ${message}`);
  }

  /** A cached access token, refreshed with the stored refresh token when it expires. */
  private async accessToken(account: DriveAccountRow): Promise<string> {
    const cached = this.tokens.get(account.id);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    let refreshToken: string;
    try {
      refreshToken = this.box.open(account.refreshToken);
    } catch {
      throw await this.broken(
        account,
        'the stored token cannot be decrypted (the server key changed)',
      );
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: this.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      if (body.error === 'invalid_grant') {
        throw await this.broken(account, 'Google access was revoked or has expired');
      }
      throw new DriveReadError(
        `Google token refresh failed for ${account.email}: ${body.error ?? res.status}`,
      );
    }
    this.tokens.set(account.id, {
      token: body.access_token,
      expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    });
    return body.access_token;
  }

  private async broken(account: DriveAccountRow, why: string): Promise<DriveReadError> {
    await this.prisma.googleDriveAccount.update({
      where: { id: account.id },
      data: { error: why },
    });
    return new DriveReadError(`${account.email}: ${why}. Reconnect this Google account.`);
  }
}

/** The account cannot see the file (Drive answers 404 for both "missing" and "not shared"). */
class NoAccess extends DriveReadError {}
