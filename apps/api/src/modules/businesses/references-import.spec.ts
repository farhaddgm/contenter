import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../common/auth.decorators';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { DriveNoAccessError, DriveReadError } from '../google-drive/google-drive.service';
import { ReferencesService } from './references.service';

const user = { id: 'u1', role: 'ADMIN' } as AuthUser;
const DOC = 'https://docs.google.com/document/d/DOC1abcdefgh/edit';
const SHEET = 'https://docs.google.com/spreadsheets/d/SHEET1abcdefg/edit';
const PDF = 'https://drive.google.com/file/d/PDF1abcdefgh/view';
const SECRET = 'https://docs.google.com/document/d/SECRET1abcdef/edit';
const FOLDER = 'https://drive.google.com/drive/folders/FOLDER1abcdef';

function make(existing: string[] = [], rows: unknown[] = []) {
  const prisma = {
    businessReference: {
      findMany: vi.fn().mockResolvedValue(rows.length ? rows : existing.map((url) => ({ url }))),
    },
  } as unknown as PrismaService;
  const drive = {
    modifiedTime: vi.fn(async (id: string) => {
      if (id === 'SECRET1abcdef') throw new DriveNoAccessError();
      return id === 'DOC1abcdefgh' ? '2026-11-05T00:00:00.000Z' : '2026-11-01T00:00:00.000Z';
    }),
    inspectFile: vi.fn(async (id: string) => {
      if (id === 'SECRET1abcdef') throw new DriveNoAccessError('not shared with reader@x.iam');
      if (id === 'PDF1abcdefgh')
        return { title: 'قرارداد', mimeType: 'application/pdf', readable: false };
      return {
        title: `سند ${id}`,
        mimeType: 'application/vnd.google-apps.document',
        readable: true,
      };
    }),
    listFolder: vi.fn(async () => ({
      name: 'اسناد برند',
      files: [
        { id: 'a', name: 'a', mimeType: 'm', url: DOC },
        { id: 'b', name: 'b', mimeType: 'm', url: SHEET },
      ],
      skipped: [{ name: 'logo.png', mimeType: 'image/png' }],
      truncated: false,
      accountId: null,
    })),
  };
  const service = new ReferencesService(
    prisma,
    { log: vi.fn() } as unknown as AuditService,
    drive as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, drive };
}

describe('list upload preview (docs/77 phase 3)', () => {
  it('classifies each link without saving anything', async () => {
    const { service, drive } = make([SHEET]);
    const out = await service.previewList('b1', [
      DOC,
      SECRET,
      PDF,
      SHEET,
      'https://brand.ir/about',
      'https://instagram.com/p/abc',
      DOC, // repeated link counts once
    ]);
    const by = Object.fromEntries(out.map((i) => [i.url, i]));
    expect(out).toHaveLength(6);
    expect(by[DOC]).toMatchObject({
      kind: 'GOOGLE_FILE',
      state: 'READY',
      title: 'سند DOC1abcdefgh',
    });
    expect(by[SECRET]).toMatchObject({ state: 'NO_ACCESS' });
    expect(by[SECRET]!.reason).toContain('not shared');
    expect(by[PDF]).toMatchObject({ state: 'REJECTED', mimeType: 'application/pdf' });
    expect(by[SHEET]).toMatchObject({ state: 'DUPLICATE' });
    expect(by['https://brand.ir/about']).toMatchObject({ kind: 'LINK', state: 'UNCHECKED' });
    expect(by['https://instagram.com/p/abc']).toMatchObject({ state: 'REJECTED' });
    // the business id goes with every Drive look-up, so account scoping applies
    expect(drive.inspectFile).toHaveBeenCalledWith('DOC1abcdefgh', 'b1');
  });

  it('lists a folder so its files can be ticked one by one', async () => {
    const { service } = make([SHEET]);
    const [folder] = await service.previewList('b1', [FOLDER]);
    expect(folder).toMatchObject({ kind: 'GOOGLE_FOLDER', state: 'READY', skipped: 1 });
    expect(folder!.files.map((f) => [f.url, f.duplicate])).toEqual([
      [DOC, false],
      [SHEET, true],
    ]);
  });

  it('reports a folder nobody can open instead of failing the whole list', async () => {
    const { service, drive } = make();
    drive.listFolder.mockRejectedValueOnce(new DriveNoAccessError('share it with reader@x.iam'));
    drive.inspectFile.mockRejectedValueOnce(new DriveReadError('Drive is down'));
    const out = await service.previewList('b1', [FOLDER, DOC]);
    expect(out[0]).toMatchObject({ state: 'NO_ACCESS' });
    expect(out[1]).toMatchObject({ state: 'REJECTED', reason: 'Drive is down' });
  });
});

describe('list upload import', () => {
  it('adds each item through `add`, with shared defaults, and keeps going after a failure', async () => {
    const { service } = make();
    const add = vi
      .spyOn(service, 'add')
      .mockResolvedValueOnce({ references: [{ id: 'r1' }], skipped: 0, assets: 0 } as never)
      .mockRejectedValueOnce(new Error('This link is already a reference'))
      .mockResolvedValueOnce({
        references: [{ id: 'r3' }, { id: 'r4' }],
        skipped: 0,
        assets: 0,
      } as never);
    const out = await service.importList(
      'b1',
      {
        items: [{ url: DOC }, { url: SHEET }, { url: FOLDER, audience: 'BOTH' }],
        description: 'قیمت‌ها',
        audience: 'APPS',
      },
      user,
    );
    expect(out).toMatchObject({ added: 3, failed: 1 });
    expect(out.results.map((r) => [r.url, r.ok])).toEqual([
      [DOC, true],
      [SHEET, false],
      [FOLDER, true],
    ]);
    const sent = add.mock.calls.map((c) => c[1]);
    expect(sent).toContainEqual(
      expect.objectContaining({ url: DOC, description: 'قیمت‌ها', audience: 'APPS' }),
    );
    expect(sent).toContainEqual(expect.objectContaining({ url: FOLDER, audience: 'BOTH' }));
  });

  it('refuses a list over the limit', async () => {
    const { service } = make();
    const items = Array.from({ length: 51 }, (_, i) => ({ url: `https://brand.ir/${i}` }));
    await expect(service.importList('b1', { items }, user)).rejects.toThrow();
  });
});

describe('change check (docs/77 phase 4)', () => {
  const row = (id: string, url: string, at: string | null) => ({
    id,
    url,
    googleAccountId: null,
    sourceModifiedAt: at ? new Date(at) : null,
  });

  it('flags only files that changed since the last read and reads no text', async () => {
    const { service, drive } = make(
      [],
      [
        row('r1', DOC, '2026-11-01T00:00:00.000Z'), // Google says Nov 5: changed
        row('r2', SHEET, '2026-11-01T00:00:00.000Z'), // same time: unchanged
        row('r3', PDF, null), // never recorded: unknown, not "changed"
        row('r4', SECRET, '2026-10-01T00:00:00.000Z'), // cannot be asked: left out
      ],
    );
    const out = await service.checkChanges('b1');
    expect(out).toEqual([
      { id: 'r1', changed: true },
      { id: 'r2', changed: false },
      { id: 'r3', changed: false },
    ]);
    expect(drive.modifiedTime).toHaveBeenCalledWith('DOC1abcdefgh', null, 'b1');
  });
});
