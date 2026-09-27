import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import type { GoogleLoginError } from '@contenter/shared';
import { ENV, type Env } from '../../config/env';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const FLOW_TTL_SECONDS = 600;
const JWKS_TTL_MS = 3_600_000;
const CLOCK_SKEW_S = 60;

/** A failed Google sign-in; `code` is shown to the user on the login page. */
export class GoogleAuthError extends Error {
  constructor(
    readonly code: GoogleLoginError,
    message: string = code,
  ) {
    super(message);
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

interface FlowState {
  state: string;
  verifier: string;
  nonce: string;
  redirectTo: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const decodeSegment = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Only same-app relative paths are allowed as post-login redirects (no open redirect). */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/app';
  if (value.includes('\\') || /[\r\n]/.test(value)) return '/app';
  return value;
}

/**
 * OpenID Connect authorization-code flow with PKCE against Google. The flow state (state,
 * PKCE verifier, nonce, redirect) lives in a short-lived signed cookie, so no server storage.
 * The id_token is fetched directly from Google and its signature is checked against Google's JWKS.
 */
@Injectable()
export class GoogleOAuthService {
  private jwks: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;

  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get enabled(): boolean {
    return !!(
      this.env.GOOGLE_CLIENT_ID &&
      this.env.GOOGLE_CLIENT_SECRET &&
      this.env.GOOGLE_REDIRECT_URI
    );
  }

  /** Builds Google's consent URL and the signed flow cookie that the callback verifies. */
  async start(redirectTo: unknown): Promise<{ url: string; flowToken: string }> {
    if (!this.enabled) throw new GoogleAuthError('not_configured');
    const flow: FlowState = {
      state: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(48)),
      nonce: b64url(randomBytes(24)),
      redirectTo: safeRedirectPath(redirectTo),
    };
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID!,
      redirect_uri: this.env.GOOGLE_REDIRECT_URI!,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: b64url(createHash('sha256').update(flow.verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    const flowToken = await this.jwt.signAsync(flow, {
      secret: this.env.JWT_REFRESH_SECRET,
      audience: 'google-oauth',
      expiresIn: FLOW_TTL_SECONDS,
    });
    return { url: `${AUTH_URL}?${params}`, flowToken };
  }

  get flowMaxAgeMs() {
    return FLOW_TTL_SECONDS * 1000;
  }

  /** Validates the callback against the flow cookie and returns the verified Google identity. */
  async finish(
    query: { code?: string; state?: string; error?: string },
    flowToken: string | undefined,
  ): Promise<{ identity: GoogleIdentity; redirectTo: string }> {
    if (!this.enabled) throw new GoogleAuthError('not_configured');
    if (query.error) throw new GoogleAuthError('cancelled', `Google returned ${query.error}`);

    let flow: FlowState;
    try {
      flow = await this.jwt.verifyAsync<FlowState>(flowToken ?? '', {
        secret: this.env.JWT_REFRESH_SECRET,
        audience: 'google-oauth',
      });
    } catch {
      throw new GoogleAuthError('expired', 'Missing or expired OAuth flow cookie');
    }
    if (!query.code || !query.state || query.state !== flow.state) {
      throw new GoogleAuthError('expired', 'OAuth state mismatch');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: this.env.GOOGLE_CLIENT_ID!,
        client_secret: this.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: this.env.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !body.id_token) {
      throw new GoogleAuthError(
        'failed',
        `Token exchange failed: ${res.status} ${body.error ?? ''}`,
      );
    }
    const identity = await this.verifyIdToken(body.id_token, flow.nonce);
    return { identity, redirectTo: flow.redirectTo };
  }

  private async verifyIdToken(idToken: string, nonce: string): Promise<GoogleIdentity> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new GoogleAuthError('failed', 'Malformed id_token');
    const [h, p, s] = parts as [string, string, string];
    const header = decodeSegment(h) as { alg?: string; kid?: string };
    const claims = decodeSegment(p) as Record<string, unknown>;

    const key = header.kid ? await this.signingKey(header.kid) : undefined;
    const signed =
      header.alg === 'RS256' &&
      !!key &&
      verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
    if (!signed) throw new GoogleAuthError('failed', 'Invalid id_token signature');

    const now = Math.floor(Date.now() / 1000);
    if (
      !ISSUERS.includes(String(claims.iss)) ||
      claims.aud !== this.env.GOOGLE_CLIENT_ID ||
      typeof claims.exp !== 'number' ||
      claims.exp < now - CLOCK_SKEW_S ||
      claims.nonce !== nonce ||
      typeof claims.sub !== 'string' ||
      typeof claims.email !== 'string'
    ) {
      throw new GoogleAuthError('failed', 'Invalid id_token claims');
    }
    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: typeof claims.name === 'string' ? claims.name : undefined,
    };
  }

  private async signingKey(kid: string): Promise<KeyObject | undefined> {
    const fresh = this.jwks && Date.now() - this.jwks.fetchedAt < JWKS_TTL_MS;
    if (!fresh || !this.jwks!.keys.has(kid)) {
      const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new GoogleAuthError('failed', `JWKS fetch failed: ${res.status}`);
      const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
      this.jwks = {
        keys: new Map(keys.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })])),
        fetchedAt: Date.now(),
      };
    }
    return this.jwks!.keys.get(kid);
  }
}
