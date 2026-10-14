import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import { QueueService } from './queue.service';

function withConnection(conn: unknown) {
  const svc = new QueueService({
    QUEUE_DRIVER: 'inline',
    APP_ROLE: 'all',
    WORKER_CONCURRENCY: 1,
  } as Env);
  (svc as unknown as { connection: unknown }).connection = conn;
  return svc;
}

describe('QueueService worker heartbeat', () => {
  it('counts the heartbeat keys over every scan page', async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(['17', ['contenter:worker:a:1', 'contenter:worker:b:2']])
      .mockResolvedValueOnce(['0', ['contenter:worker:c:3']]);
    const n = await withConnection({ scan }).liveWorkers();
    expect(n).toBe(3);
    expect(scan.mock.calls[0]).toEqual(['0', 'MATCH', 'contenter:worker:*', 'COUNT', 100]);
    expect(scan.mock.calls[1]![0]).toBe('17');
  });

  it('is 0 when Redis cannot be asked, and 0 for the inline queue', async () => {
    expect(
      await withConnection({ scan: vi.fn().mockRejectedValue(new Error('down')) }).liveWorkers(),
    ).toBe(0);
    expect(await withConnection(undefined).liveWorkers()).toBe(0);
  });
});
