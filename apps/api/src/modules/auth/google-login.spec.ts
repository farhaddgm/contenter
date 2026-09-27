import { describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import type { Env } from '../../config/env';
import { AuthService } from './auth.service';
import { GoogleAuthError, safeRedirectPath, type GoogleIdentity } from './google-oauth.service';

const OWNER = 'farhad.dgm@gmail.com';

function user(over: Partial<User>): User {
  return {
    id: 'u1',
    email: 'ali@gmail.com',
    name: 'Ali',
    passwordHash: null,
    role: 'EDITOR',
    isActive: true,
    loginMethod: 'GOOGLE',
    googleSub: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function setup(users: User[]) {
  const created: User[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { googleSub?: string; email?: string } }) =>
        where.googleSub
          ? (users.find((u) => u.googleSub === where.googleSub) ?? null)
          : (users.find((u) => u.email === where.email) ?? null),
      ),
      findMany: vi.fn(async () => users),
      create: vi.fn(async ({ data }: { data: Partial<User> }) => {
        const u = user({ id: 'new', ...data });
        created.push(u);
        return u;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<User> }) => ({
        ...[...users, ...created].find((u) => u.id === where.id)!,
        ...data,
      })),
    },
    refreshToken: { create: vi.fn(async () => ({})) },
  };
  const jwt = { signAsync: vi.fn(async () => 'access') };
  const audit = { log: vi.fn() };
  const env = {
    OWNER_EMAIL: OWNER,
    JWT_ACCESS_SECRET: 'x'.repeat(16),
    JWT_ACCESS_TTL_SECONDS: 900,
    REFRESH_TTL_DAYS: 30,
  } as Env;
  const auth = new AuthService(prisma as never, jwt as never, audit as never, env);
  return { auth, prisma, created };
}

const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  sub: 'g-1',
  email: 'ali@gmail.com',
  emailVerified: true,
  name: 'Ali',
  ...over,
});
const meta = { ip: '127.0.0.1' };

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof GoogleAuthError ? e.code : String(e);
  }
}

describe('AuthService.loginWithGoogle', () => {
  it('provisions the owner as ADMIN on first sign-in', async () => {
    const { auth, created } = setup([]);
    const res = await auth.loginWithGoogle(identity({ email: 'farhaddgm@gmail.com' }), meta);
    expect(created[0]).toMatchObject({ email: OWNER, role: 'ADMIN', loginMethod: 'GOOGLE' });
    expect(res.user).toMatchObject({ isOwner: true, role: 'ADMIN', hasPassword: false });
  });

  it('rejects Gmail accounts that are not on the allowlist', async () => {
    expect(await code(setup([]).auth.loginWithGoogle(identity(), meta))).toBe('not_allowed');
    const pwOnly = setup([user({ loginMethod: 'PASSWORD', passwordHash: 'h' })]);
    expect(await code(pwOnly.auth.loginWithGoogle(identity(), meta))).toBe('not_allowed');
  });

  it('rejects non-Gmail or unverified addresses', async () => {
    const { auth } = setup([user({})]);
    expect(await code(auth.loginWithGoogle(identity({ email: 'a@corp.com' }), meta))).toBe(
      'not_gmail',
    );
    expect(await code(auth.loginWithGoogle(identity({ emailVerified: false }), meta))).toBe(
      'not_gmail',
    );
  });

  it('signs in a granted user (dot-insensitive) and binds the Google id', async () => {
    const { auth, prisma } = setup([user({ email: 'ali.r@gmail.com', loginMethod: 'BOTH' })]);
    const res = await auth.loginWithGoogle(identity({ email: 'alir@gmail.com' }), meta);
    expect(res.user.email).toBe('ali.r@gmail.com');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ googleSub: 'g-1' }) }),
    );
  });

  it('refuses a different Google account for an already bound address', async () => {
    const { auth } = setup([user({ googleSub: 'g-original' })]);
    expect(await code(auth.loginWithGoogle(identity({ sub: 'g-other' }), meta))).toBe(
      'not_allowed',
    );
  });

  it('refuses inactive users', async () => {
    const { auth } = setup([user({ isActive: false })]);
    expect(await code(auth.loginWithGoogle(identity(), meta))).toBe('inactive');
  });
});

describe('password login for Google-only accounts', () => {
  it('is rejected even with a stale password hash', async () => {
    const { auth } = setup([user({ loginMethod: 'GOOGLE', passwordHash: 'stale' })]);
    await expect(auth.login('ali@gmail.com', 'whatever', meta)).rejects.toThrow('Invalid');
  });
});

describe('safeRedirectPath', () => {
  it('keeps same-app paths and blocks open redirects', () => {
    expect(safeRedirectPath('/app/topics')).toBe('/app/topics');
    expect(safeRedirectPath('//evil.com')).toBe('/app');
    expect(safeRedirectPath('https://evil.com')).toBe('/app');
    expect(safeRedirectPath(String.raw`/\evil.com`)).toBe('/app');
    expect(safeRedirectPath(undefined)).toBe('/app');
  });
});
