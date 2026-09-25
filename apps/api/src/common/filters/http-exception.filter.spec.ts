import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorTrackerService } from '../../modules/smart/smart-core.services';
import { AllExceptionsFilter } from './http-exception.filter';

function setup() {
  const record = vi.fn().mockResolvedValue('err_123');
  const filter = new AllExceptionsFilter({ record } as unknown as ErrorTrackerService);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const req = { method: 'POST', originalUrl: '/api/topics?x=1', headers: { 'x-client-route': '/app/topics' }, body: { password: 'secret', title: 't' }, user: { id: 'u1' } };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost;
  return { filter, res, host, record };
}

describe('AllExceptionsFilter', () => {
  it('records unexpected errors and returns their errorId', async () => {
    const { filter, res, host, record } = setup();
    await filter.catch(new Error('boom'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error', errorId: 'err_123' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'SERVER', message: 'boom', statusCode: 500, method: 'POST', path: '/api/topics', route: '/app/topics', userId: 'u1' }),
    );
  });

  it('does not record client errors (4xx)', async () => {
    const { filter, res, host, record } = setup();
    await filter.catch(new BadRequestException('bad'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(record).not.toHaveBeenCalled();
  });
});
