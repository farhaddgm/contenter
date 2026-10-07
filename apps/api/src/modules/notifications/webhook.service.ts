import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { WebhookPayload } from '@contenter/shared';

export const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * The signature receivers verify: HMAC-SHA256 over `<timestamp>.<body>`, hex. The timestamp is
 * part of what is signed, so a captured request cannot be replayed later with a fresh timestamp.
 */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Posts one event to the webhook of the system. */
@Injectable()
export class WebhookService {
  /**
   * Resolves on a 2xx answer and throws otherwise (`HTTP 500`, a timeout, a refused connection).
   * Redirects are not followed: a webhook that moved must be re-entered, not silently chased.
   */
  async post(url: string, secret: string | null, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Contenter-Webhook/1',
        'X-Contenter-Event': payload.test ? 'test' : payload.event,
        'X-Contenter-Delivery': payload.id,
        'X-Contenter-Timestamp': timestamp,
        ...(secret
          ? { 'X-Contenter-Signature': `sha256=${signWebhook(secret, timestamp, body)}` }
          : {}),
      },
      body,
    });
    // the answer is not stored; drain it so the connection can be reused
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}
