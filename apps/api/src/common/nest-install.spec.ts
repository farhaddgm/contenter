import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two copies of @nestjs/core or @nestjs/common break dependency injection when the app boots
 * ("Nest can't resolve dependencies of the ThrottlerGuard (..., ?)": the Reflector of one copy is
 * not the token the other expects). Unit tests never boot the real app, so this guards the install
 * layout instead. npm can leave a stale hoisted copy after a major upgrade; see docs/13 section 10.
 */
describe('NestJS install layout', () => {
  const lock = JSON.parse(readFileSync(resolve(__dirname, '../../../../package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };

  for (const name of ['core', 'common', 'platform-express']) {
    it(`@nestjs/${name} is installed exactly once`, () => {
      const copies = Object.keys(lock.packages).filter((key) =>
        new RegExp(`(^|/)node_modules/@nestjs/${name}$`).test(key),
      );
      expect(copies).toHaveLength(1);
    });
  }

  it('core, common and platform-express are on the same major', () => {
    const major = (name: string) => {
      const key = Object.keys(lock.packages).find((k) => k.endsWith(`node_modules/@nestjs/${name}`));
      return lock.packages[key ?? '']?.version?.split('.')[0];
    };
    expect(new Set([major('core'), major('common'), major('platform-express')]).size).toBe(1);
  });
});
