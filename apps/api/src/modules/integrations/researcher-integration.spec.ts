import { NotFoundException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import { ResearcherIntegrationController, ResearcherIntegrationGuard } from './researcher-integration';
import { DocooExportService } from './docoo-export.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const researcherToken = 'r'.repeat(40), docooToken = 'd'.repeat(40);
const env = (extra = {}) => ({ RESEARCHER_INTEGRATION_TOKEN: researcherToken, INTEGRATION_TOKEN: docooToken, RESEARCHER_BUSINESS_ACCESS: 'selected', RESEARCHER_BUSINESS_IDS: ['allowed'], ...extra }) as unknown as Env;
const ctx = (authorization?: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) }) as ExecutionContext;

describe('Researcher integration: independent read-only consumer', () => {
  it('accepts only its own token', () => {
    const guard = new ResearcherIntegrationGuard(env());
    expect(guard.canActivate(ctx(`Bearer ${researcherToken}`))).toBe(true);
    for (const token of [undefined, [], `Bearer ${docooToken}`, 'Bearer bad']) {
      expect(() => guard.canActivate(ctx(token))).toThrow(UnauthorizedException);
    }
  });
  it('is disabled without a token or when the Docoo token was reused', () => {
    expect(() => new ResearcherIntegrationGuard(env({ RESEARCHER_INTEGRATION_TOKEN: undefined })).canActivate(ctx())).toThrow(NotFoundException);
    expect(() => new ResearcherIntegrationGuard(env({ RESEARCHER_INTEGRATION_TOKEN: docooToken })).canActivate(ctx(`Bearer ${docooToken}`))).toThrow(NotFoundException);
  });
  it('refuses a non-allowlisted export before querying storage', () => {
    const service = { export: vi.fn() } as unknown as DocooExportService;
    const controller = new ResearcherIntegrationController(service, env());
    expect(() => controller.export('other', { ip: '127.0.0.1' } as never)).toThrow(NotFoundException);
    expect(service.export).not.toHaveBeenCalled();
  });
  it('uses a distinct audit consumer on authorized export', () => {
    const service = { export: vi.fn() } as unknown as DocooExportService;
    new ResearcherIntegrationController(service, env()).export('allowed', { ip: '127.0.0.1' } as never);
    expect(service.export).toHaveBeenCalledWith('allowed', '127.0.0.1', 'researcher');
  });
  it('includes every current and future business only after explicit all-mode opt-in', () => {
    const service = { export: vi.fn(), ping: vi.fn(), list: vi.fn() } as unknown as DocooExportService;
    const controller = new ResearcherIntegrationController(service, env({ RESEARCHER_BUSINESS_ACCESS: 'all', RESEARCHER_BUSINESS_IDS: [] }));
    controller.ping();
    controller.list({ page: 1, pageSize: 20 });
    controller.export('new-future-business', { ip: '127.0.0.1' } as never);
    expect(service.ping).toHaveBeenCalledWith(undefined);
    expect(service.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 }, undefined);
    expect(service.export).toHaveBeenCalledWith('new-future-business', '127.0.0.1', 'researcher');
  });
  it('filters counts and both list queries, including deny-all', async () => {
    const db = { business: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) }, $transaction: vi.fn((calls) => Promise.all(calls)) };
    const service = new DocooExportService(db as unknown as PrismaService, {} as AuditService);
    for (const ids of [[], ['allowed']]) {
      await service.ping(ids);
      expect(db.business.count).toHaveBeenLastCalledWith({ where: { id: { in: ids } } });
      await service.list({ page: 1, pageSize: 20, q: 'finance' }, ids);
      expect(db.business.findMany.mock.lastCall?.[0].where.id).toEqual({ in: ids });
      expect(db.business.count.mock.lastCall?.[0].where.id).toEqual({ in: ids });
    }
  });
});
