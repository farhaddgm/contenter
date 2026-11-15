import { createSign } from 'node:crypto';

/** What is needed of a Google service account key file (docs/77). */
export interface ServiceAccountKey {
  email: string;
  privateKey: string;
}

/**
 * Reads the key from the env value: the key file's JSON, or the same JSON base64-encoded (easier
 * to keep in one line of an env file). Returns null for an empty, malformed or incomplete value —
 * the feature then stays off instead of failing the boot.
 */
export function parseServiceAccountKey(raw: string | undefined | null): ServiceAccountKey | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const candidates = text.startsWith('{')
    ? [text]
    : [
        (() => {
          try {
            return Buffer.from(text, 'base64').toString('utf8');
          } catch {
            return '';
          }
        })(),
      ];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as { client_email?: unknown; private_key?: unknown; type?: unknown };
      if (
        typeof j.client_email === 'string' &&
        typeof j.private_key === 'string' &&
        j.private_key.includes('PRIVATE KEY') &&
        (j.type === undefined || j.type === 'service_account')
      ) {
        return { email: j.client_email.toLowerCase(), privateKey: j.private_key };
      }
    } catch {
      /* not JSON */
    }
  }
  return null;
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** The signed JWT assertion Google exchanges for an access token (RS256, one hour). */
export function serviceAccountAssertion(
  key: ServiceAccountKey,
  scope: string,
  audience: string,
  nowSeconds: number,
): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.email,
      scope,
      aud: audience,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}
