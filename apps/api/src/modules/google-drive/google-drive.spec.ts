import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { DriveNoAccessError, GoogleDriveService } from './google-drive.service';
import { parseServiceAccountKey, serviceAccountAssertion } from './service-account';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const keyJson = JSON.stringify({
  type: 'service_account',
  client_email: 'Reader@Proj.iam.gserviceaccount.com',
  private_key: privateKey,
});

describe('service account key (docs/77)', () => {
  it('reads the JSON or its base64 form and lower-cases the address', () => {
    for (const raw of [keyJson, Buffer.from(keyJson).toString('base64')]) {
      expect(parseServiceAccountKey(raw)?.email).toBe('reader@proj.iam.gserviceaccount.com');
    }
  });

  it('stays off for empty, malformed, incomplete or non-service-account values', () => {
    for (const raw of [
      '',
      undefined,
      '   ',
      'not json',
      '{"client_email":"a@b.c"}',
      JSON.stringify({ client_email: 'a@b.c', private_key: 'plain' }),
      JSON.stringify({ type: 'authorized_user', client_email: 'a@b.c', private_key: privateKey }),
    ]) {
      expect(parseServiceAccountKey(raw)).toBeNull();
    }
  });

  it('signs an RS256 assertion Google can verify with the public key', () => {
    const key = parseServiceAccountKey(keyJson)!;
    const jwt = serviceAccountAssertion(key, 'scope-x', 'https://aud', 1_000);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({
      iss: 'reader@proj.iam.gserviceaccount.com',
      scope: 'scope-x',
      aud: 'https://aud',
      iat: 1_000,
      exp: 4_600,
    });
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${c}`)
      .verify(createPublicKey(publicKey), Buffer.from(sig!, 'base64url'));
    expect(ok).toBe(true);
  });
});

const account = (
  id: string,
  over: Partial<{ allBusinesses: boolean; businessIds: string[] }> = {},
) => ({
  id,
  email: `${id}@gmail.com`,
  refreshToken: 'sealed',
  allBusinesses: true,
  businessIds: [] as string[],
  ...over,
});

function service(accounts: ReturnType<typeof account>[], saJson?: string) {
  const prisma = {
    googleDriveAccount: {
      findMany: vi.fn().mockResolvedValue(accounts),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: saJson,
    JWT_REFRESH_SECRET: 'x'.repeat(40),
  } as unknown as Env;
  return new GoogleDriveService(
    prisma,
    {} as JwtService,
    { log: vi.fn() } as unknown as AuditService,
    env,
  );
}

describe('GoogleDriveService credentials (docs/77)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes the service account address only when the key is valid', () => {
    expect(service([], keyJson).serviceAccountEmail).toBe('reader@proj.iam.gserviceaccount.com');
    expect(service([], 'garbage').serviceAccountEmail).toBeNull();
    expect(service([]).serviceAccountEmail).toBeNull();
  });

  it('does not use an account that is limited to other businesses', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const drive = service([account('a', { allBusinesses: false, businessIds: ['other'] })]);
    await expect(drive.readFile('file1', null, 'biz1')).rejects.toBeInstanceOf(DriveNoAccessError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the service account first and says whom to share the file with', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return Response.json({ access_token: 'tok', expires_in: 3600 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    const drive = service([account('a', { allBusinesses: false, businessIds: ['biz1'] })], keyJson);
    await expect(drive.readFile('file1', null, 'biz1')).rejects.toThrow(
      /shared with reader@proj\.iam\.gserviceaccount\.com, a@gmail\.com.*Share it.*with reader@proj/,
    );
    // the service account token was requested before any Drive call
    expect(urls[0]).toContain('oauth2.googleapis.com/token');
  });
});
