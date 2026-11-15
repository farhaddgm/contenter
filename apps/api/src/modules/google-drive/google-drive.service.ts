import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { GoogleDriveAccount as DriveAccountRow } from '@prisma/client';
import type { GoogleDriveStatus, UpdateDriveAccountInput } from '@contenter/shared';
import { type AuthUser } from '../../common/auth.decorators';
import { SecretBox } from '../../common/secret-box';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { safeRedirectPath } from '../auth/google-oauth.service';
import { extractText } from '../businesses/document-text';
import { xlsxToText } from './xlsx-text';
import {
  parseServiceAccountKey,
  serviceAccountAssertion,
  type ServiceAccountKey,
} from './service-account';

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

/** The account(s) cannot see the file (Drive answers 404 for both "missing" and "not shared"). */
export class DriveNoAccessError extends DriveReadError {}

/** Marks the credential that is the service account rather than a connected OAuth account. */
const SA_ID = 'service-account';
type SaCred = { id: typeof SA_ID; email: string; sa: true };
type Cred = DriveAccountRow | SaCred;

interface FlowState {
  state: string;
  verifier: string;
  userId: string;
  redirectTo: string;
}

export interface DriveFile {
  title: string;
  text: string;
  /** When the file last changed at Google (RFC 3339), to tell later that it moved on. */
  modifiedAt: string | null;
  /** The connected account that read it; null = the service account. */
  accountId: string | null;
}

export interface DriveFolder {
  name: string;
  /** Files that can be read as text, with a canonical link each. */
  files: { id: string; name: string; mimeType: string; url: string }[];
  /** Files that cannot be read as text (PDF, images, Office files …). */
  skipped: { name: string; mimeType: string }[];
  /** More readable files exist than the per-folder limit. */
  truncated: boolean;
  accountId: string | null;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_DEPTH = 3;
const FOLDER_MAX_FILES = 40;

/** The link a person would open for a Drive file (also what `parseGoogleFileUrl` recognizes). */
export function driveFileUrl(file: { id: string; mimeType: string }): string {
  const app = {
    'application/vnd.google-apps.document': 'document',
    'application/vnd.google-apps.spreadsheet': 'spreadsheets',
    'application/vnd.google-apps.presentation': 'presentation',
  }[file.mimeType];
  return app
    ? `https://docs.google.com/${app}/d/${file.id}/edit`
    : `https://drive.google.com/file/d/${file.id}/view`;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Largest uploaded Drive file (PDF, Word, Excel) downloaded to be read. */
export const DRIVE_BINARY_MAX_BYTES = 25_000_000;

export type DrivePlan =
  | { export: string; fallback?: string; xlsx?: boolean }
  | { binary: 'pdf' | 'docx' | 'xlsx' }
  | 'download'
  | null;

/**
 * How each Drive file type is turned into text. Null = not readable as text. A Google Sheet is
 * exported as .xlsx so every tab is read (CSV export has only the first); uploaded PDF, Word and
 * Excel files are downloaded and read by code (docs/77 phase 4).
 */
export function driveExportPlan(mimeType: string): DrivePlan {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return { export: 'text/markdown', fallback: 'text/plain' };
    case 'application/vnd.google-apps.spreadsheet':
      return { export: XLSX_MIME, xlsx: true, fallback: 'text/csv' };
    case 'application/pdf':
      return { binary: 'pdf' };
    case DOCX_MIME:
      return { binary: 'docx' };
    case XLSX_MIME:
      return { binary: 'xlsx' };
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
  private readonly sa: ServiceAccountKey | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET, 'google-drive');
    this.sa = parseServiceAccountKey(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (env.GOOGLE_SERVICE_ACCOUNT_JSON && !this.sa) {
      this.logger.warn('GOOGLE_SERVICE_ACCOUNT_JSON is set but is not a valid service account key');
    }
  }

  /** The address a document must be shared with so the server can read it (null = off). */
  get serviceAccountEmail(): string | null {
    return this.sa?.email ?? null;
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
        allBusinesses: true,
        businessIds: true,
        createdAt: true,
        connectedBy: USER_REF,
      },
    });
    return {
      configured: this.enabled,
      redirectUri: this.redirectUri,
      serviceAccountEmail: this.serviceAccountEmail,
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

  /** Chooses which businesses a connected account may read (docs/77); admins only (controller). */
  async updateScope(id: string, input: UpdateDriveAccountInput, user: AuthUser) {
    const account = await this.prisma.googleDriveAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Google account not found');
    const businessIds = input.allBusinesses ? [] : [...new Set(input.businessIds)];
    await this.prisma.googleDriveAccount.update({
      where: { id },
      data: { allBusinesses: input.allBusinesses, businessIds },
    });
    this.audit.log({
      userId: user.id,
      action: 'google_drive.scope',
      entityType: 'GoogleDriveAccount',
      entityId: id,
      meta: {
        email: account.email,
        allBusinesses: input.allBusinesses,
        businesses: businessIds.length,
      },
    });
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
   * Reads a Drive file as text with the first credential that can open it: the preferred account,
   * then the service account, then the connected accounts allowed for `businessId`. Throws
   * DriveReadError with an admin-readable reason (DriveNoAccessError when nobody can see it).
   */
  async readFile(
    fileId: string,
    preferredAccountId?: string | null,
    businessId?: string | null,
  ): Promise<DriveFile> {
    return this.withAccount('file', preferredAccountId, businessId, (account) =>
      this.readWith(account, fileId),
    );
  }

  /**
   * Lists the files of a Drive folder (sub-folders included, a few levels deep) with the first
   * credential that can open it. `files` are the ones readable as text; `skipped` are the rest
   * (PDF, images, Office files ...), reported to the admin.
   */
  async listFolder(
    folderId: string,
    preferredAccountId?: string | null,
    businessId?: string | null,
  ): Promise<DriveFolder> {
    return this.withAccount('folder', preferredAccountId, businessId, (account) =>
      this.listWith(account, folderId),
    );
  }

  /**
   * Looks at a Drive file without reading it (name and type only): which credential can open it,
   * and whether its type can be read as text. Used by the list-upload preview (docs/77).
   */
  async inspectFile(
    fileId: string,
    businessId?: string | null,
  ): Promise<{ title: string; mimeType: string; readable: boolean }> {
    return this.withAccount('file', null, businessId, async (account) => {
      const token = await this.accessToken(account);
      const res = await fetch(
        `${DRIVE_URL}/${encodeURIComponent(fileId)}?fields=name,mimeType&supportsAllDrives=true`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (res.status === 404) throw new DriveNoAccessError();
      if (!res.ok) throw await this.apiError(res, account);
      const meta = (await res.json()) as { name?: string; mimeType?: string };
      const mimeType = meta.mimeType ?? '';
      return { title: meta.name ?? '', mimeType, readable: !!driveExportPlan(mimeType) };
    });
  }

  /**
   * When a Google file last changed, without reading it (docs/77 phase 4). Null for a file the
   * accounts cannot see or that has no such time.
   */
  async modifiedTime(
    fileId: string,
    preferredAccountId?: string | null,
    businessId?: string | null,
  ): Promise<string | null> {
    const out = await this.withAccount('file', preferredAccountId, businessId, async (account) => {
      const token = await this.accessToken(account);
      const res = await fetch(
        `${DRIVE_URL}/${encodeURIComponent(fileId)}?fields=modifiedTime&supportsAllDrives=true`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (res.status === 404) throw new DriveNoAccessError();
      if (!res.ok) throw await this.apiError(res, account);
      const meta = (await res.json()) as { modifiedTime?: string };
      return { modifiedAt: meta.modifiedTime ?? null };
    });
    return out.modifiedAt;
  }

  /** Runs `fn` with each usable credential until one can see the item. */
  private async withAccount<T>(
    what: 'file' | 'folder',
    preferredAccountId: string | null | undefined,
    businessId: string | null | undefined,
    fn: (account: Cred) => Promise<T>,
  ): Promise<T & { accountId: string | null }> {
    const rows = await this.prisma.googleDriveAccount.findMany({
      orderBy: { createdAt: 'asc' },
    });
    // docs/77: an OAuth account only opens the businesses its admin allowed (all by default).
    const allowed = rows.filter(
      (a) => a.allBusinesses || !businessId || a.businessIds.includes(businessId),
    );
    const creds: Cred[] = [
      ...(this.sa ? [{ id: SA_ID, email: this.sa.email, sa: true } as SaCred] : []),
      ...allowed,
    ];
    const shareWith = [...(this.sa ? [this.sa.email] : []), ...allowed.map((a) => a.email)];
    if (!creds.length) {
      throw new DriveNoAccessError(
        `This Google ${what} is private and no Google account is available for this business. Connect an account or set up the service account (Settings > Google Drive), or paste the text instead.`,
      );
    }
    creds.sort((a, b) => Number(b.id === preferredAccountId) - Number(a.id === preferredAccountId));
    let lastError: DriveReadError | null = null;
    let denied = false;
    for (const account of creds) {
      try {
        const out = await fn(account);
        if (!('sa' in account)) {
          await this.prisma.googleDriveAccount.update({
            where: { id: account.id },
            data: { lastUsedAt: new Date(), error: null },
          });
        }
        return { ...out, accountId: 'sa' in account ? null : account.id };
      } catch (err) {
        if (err instanceof DriveNoAccessError) denied = true;
        else if (err instanceof DriveReadError) lastError = err;
        else throw err;
      }
    }
    if (denied) {
      throw new DriveNoAccessError(
        `The ${what} was not found or is not shared with ${shareWith.join(', ')}. Share it (viewer access is enough) with ${shareWith[0]}.`,
      );
    }
    throw lastError ?? new DriveReadError(`The Google ${what} could not be read`);
  }

  private async listWith(account: Cred, folderId: string) {
    const token = await this.accessToken(account);
    const auth = { authorization: `Bearer ${token}` };
    const get = async (url: string) => {
      const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404) throw new DriveNoAccessError();
      if (!res.ok) throw await this.apiError(res, account);
      return res.json();
    };

    const root = (await get(
      `${DRIVE_URL}/${encodeURIComponent(folderId)}?fields=name,mimeType&supportsAllDrives=true`,
    )) as { name?: string; mimeType?: string };
    if (root.mimeType !== FOLDER_MIME) {
      throw new DriveReadError('This link is not a Google Drive folder');
    }

    const files: DriveFolder['files'] = [];
    const skipped: DriveFolder['skipped'] = [];
    let level = [{ id: folderId, path: '' }];
    let truncated = false;
    for (let depth = 0; depth < FOLDER_DEPTH && level.length && !truncated; depth++) {
      const next: typeof level = [];
      for (const folder of level) {
        let pageToken: string | undefined;
        do {
          const params = new URLSearchParams({
            q: `'${folder.id}' in parents and trashed = false`,
            fields: 'nextPageToken,files(id,name,mimeType)',
            pageSize: '200',
            orderBy: 'folder,name',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true',
            ...(pageToken ? { pageToken } : {}),
          });
          const page = (await get(`${DRIVE_URL}?${params}`)) as {
            nextPageToken?: string;
            files?: { id: string; name: string; mimeType: string }[];
          };
          for (const f of page.files ?? []) {
            const name = folder.path ? `${folder.path} / ${f.name}` : f.name;
            if (f.mimeType === FOLDER_MIME) next.push({ id: f.id, path: name });
            else if (!driveExportPlan(f.mimeType)) skipped.push({ name, mimeType: f.mimeType });
            else if (files.length < FOLDER_MAX_FILES) {
              files.push({ id: f.id, name, mimeType: f.mimeType, url: driveFileUrl(f) });
            } else truncated = true;
          }
          pageToken = page.nextPageToken;
        } while (pageToken && !truncated);
      }
      level = next;
    }
    return { name: root.name ?? '', files, skipped, truncated };
  }

  private async readWith(account: Cred, fileId: string) {
    const token = await this.accessToken(account);
    const auth = { authorization: `Bearer ${token}` };
    const id = encodeURIComponent(fileId);

    const metaRes = await fetch(
      `${DRIVE_URL}/${id}?fields=name,mimeType,modifiedTime,size&supportsAllDrives=true`,
      { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (metaRes.status === 404) throw new DriveNoAccessError();
    if (!metaRes.ok) throw await this.apiError(metaRes, account);
    const meta = (await metaRes.json()) as {
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      size?: string;
    };
    const modifiedAt = meta.modifiedTime ?? null;

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
    if (typeof plan === 'object' && 'binary' in plan) {
      if (Number(meta.size ?? 0) > DRIVE_BINARY_MAX_BYTES) {
        throw new DriveReadError(
          `"${meta.name ?? fileId}" is larger than ${DRIVE_BINARY_MAX_BYTES / 1_000_000} MB; paste the part you need.`,
        );
      }
      const dl = await read(null);
      if (!dl.ok) throw await this.apiError(dl, account);
      const bytes = Buffer.from(await dl.arrayBuffer());
      try {
        const text =
          plan.binary === 'xlsx' ? await xlsxToText(bytes) : await extractText(bytes, plan.binary);
        return { title: meta.name ?? '', text, modifiedAt };
      } catch (err) {
        throw new DriveReadError(
          `"${meta.name ?? fileId}" could not be read (${err instanceof Error ? err.message : 'damaged file'}).`,
        );
      }
    }
    let res = await read(plan === 'download' ? null : plan.export);
    if (res.ok && plan !== 'download' && plan.xlsx) {
      try {
        return {
          title: meta.name ?? '',
          text: await xlsxToText(Buffer.from(await res.arrayBuffer())),
          modifiedAt,
        };
      } catch {
        res = await read(plan.fallback ?? null);
      }
    } else if (!res.ok && plan !== 'download' && plan.fallback) res = await read(plan.fallback);
    if (!res.ok) throw await this.apiError(res, account);
    return { title: meta.name ?? '', text: await res.text(), modifiedAt };
  }

  private async apiError(res: Response, account: Cred): Promise<DriveReadError> {
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
      if (res.status === 403) return new DriveNoAccessError();
    }
    return new DriveReadError(`Google Drive (${account.email}): ${message}`);
  }

  /** A cached access token, refreshed with the stored refresh token when it expires. */
  private async accessToken(account: Cred): Promise<string> {
    if ('sa' in account) return this.serviceAccountToken();
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

  /** An access token of the service account (JWT bearer grant), cached until a minute before expiry. */
  private async serviceAccountToken(): Promise<string> {
    const key = this.sa;
    if (!key) throw new DriveReadError('The Google service account is not configured');
    const cached = this.tokens.get(SA_ID);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: serviceAccountAssertion(
          key,
          DRIVE_SCOPE,
          TOKEN_URL,
          Math.floor(Date.now() / 1000),
        ),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new DriveReadError(
        `Google refused the service account (${key.email}): ${body.error ?? res.status}`,
      );
    }
    this.tokens.set(SA_ID, {
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
