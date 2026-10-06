import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isSharedHost, parsePodSpaceUrl, podSpaceUrl } from '@contenter/shared';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import {
  dispositionFileName,
  FetchError,
  matchesHostList,
  MediaFetcherService,
} from '../samples/media-fetcher.service';
import { documentKind, extractText, isTextKind } from './document-text';
import { parseChildren, PodSpaceService } from './podspace.service';

const LINK = 'https://podspace.ir/folder/RKBYIGMPW2ZIDQLI?shareHash=PN7L7RTRA9XZ8R4NBLYY';

describe('PodSpace links', () => {
  it('recognizes shared folders and files', () => {
    expect(parsePodSpaceUrl(LINK)).toEqual({
      kind: 'folder',
      hash: 'RKBYIGMPW2ZIDQLI',
      shareHash: 'PN7L7RTRA9XZ8R4NBLYY',
      origin: 'https://podspace.ir',
    });
    expect(parsePodSpaceUrl('https://www.podspace.ir/file/ABCDEF123?shareHash=X1')?.kind).toBe(
      'file',
    );
    expect(parsePodSpaceUrl('https://podspace.pod.ir/folder/ABCDEF123')).toMatchObject({
      origin: 'https://podspace.pod.ir',
      shareHash: null,
    });
  });

  it('ignores other hosts and pages', () => {
    expect(parsePodSpaceUrl('https://podspace.ir/')).toBeNull();
    expect(parsePodSpaceUrl('https://podspace.ir.evil.com/folder/ABCDEF123')).toBeNull();
    expect(parsePodSpaceUrl('https://example.com/folder/ABCDEF123')).toBeNull();
    expect(parsePodSpaceUrl('not a url')).toBeNull();
  });

  it('builds canonical file links and is a shared host', () => {
    const link = parsePodSpaceUrl(LINK)!;
    expect(podSpaceUrl({ ...link, kind: 'file', hash: 'FILE1' })).toBe(
      'https://podspace.ir/file/FILE1?shareHash=PN7L7RTRA9XZ8R4NBLYY',
    );
    expect(isSharedHost('podspace.ir')).toBe(true);
  });
});

describe('PodSpace folder walk', () => {
  const tree: Record<string, unknown[]> = {
    RKBYIGMPW2ZIDQLI: [
      { hash: 'SUB1', name: 'Posts', type: 'FOLDER' },
      { hash: 'F1', name: 'about.pdf', type: 'application/pdf', size: 1000 },
      { hash: 'F2', name: 'clip', extension: 'mp4', type: 'video/mp4' },
    ],
    SUB1: [
      { hash: 'F3', name: 'cover.jpg', type: 'image/jpeg', size: 2000 },
      { hash: 'F4', name: 'caption.txt', type: 'text/plain' },
    ],
  };
  const calls: string[] = [];
  const fetcher = {
    getJson: async (url: string) => {
      calls.push(url);
      const hash = /folders\/([^/]+)\/children/.exec(url)![1]!;
      return {
        status: 200,
        result: { list: tree[hash], count: tree[hash]!.length, entity: { name: 'Wipod' } },
      };
    },
  } as unknown as MediaFetcherService;

  it('lists every file, subfolders included, with the share token', async () => {
    const folder = await new PodSpaceService(fetcher).listFolder(parsePodSpaceUrl(LINK)!);
    expect(folder.name).toBe('Wipod');
    expect(folder.files.map((f) => [f.path, f.kind])).toEqual([
      ['about.pdf', 'pdf'],
      ['clip.mp4', 'video'],
      ['Posts/cover.jpg', 'image'],
      ['Posts/caption.txt', 'text'],
    ]);
    expect(folder.files[0]!.url).toBe('https://podspace.ir/file/F1?shareHash=PN7L7RTRA9XZ8R4NBLYY');
    expect(calls[0]).toContain('https://podspace.ir/api/folders/RKBYIGMPW2ZIDQLI/children?');
    expect(calls[0]).toContain('shareHash=PN7L7RTRA9XZ8R4NBLYY');
  });

  it('refuses a link without a share token', async () => {
    await expect(
      new PodSpaceService(fetcher).listFolder(
        parsePodSpaceUrl('https://podspace.ir/folder/RKBYIGMPW2ZIDQLI')!,
      ),
    ).rejects.toThrow(/shareHash/);
  });

  it('falls back to the legacy API host and reports every attempt', async () => {
    const tried: string[] = [];
    const failing = {
      getJson: async (url: string) => {
        tried.push(url);
        throw new FetchError('Remote server responded 404');
      },
    } as unknown as MediaFetcherService;
    await expect(new PodSpaceService(failing).listFolder(parsePodSpaceUrl(LINK)!)).rejects.toThrow(
      /Tried: .*podspace\.ir\/api.*404.*podspace\.pod\.ir\/api.*404/,
    );
    expect(tried).toHaveLength(2);
  });

  it('accepts close variants of the answer', () => {
    expect(parseChildren({ result: [{ hash: 'A' }] })?.entries).toHaveLength(1);
    expect(parseChildren({ data: { children: [{ hash: 'A' }], count: 1 } })?.count).toBe(1);
    expect(parseChildren({ result: { message: 'x' } })).toBeNull();
  });
});

describe('document text', () => {
  it('classifies files', () => {
    expect(documentKind('a.MD')).toBe('text');
    expect(documentKind('a.pdf')).toBe('pdf');
    expect(documentKind('a.docx')).toBe('docx');
    expect(documentKind('a.jpeg')).toBe('image');
    expect(documentKind('a.mov')).toBe('video');
    expect(documentKind('a.zip')).toBeNull();
    expect(documentKind('noext', 'application/pdf')).toBe('pdf');
    expect(isTextKind('image')).toBe(false);
  });

  it('reads a PDF text layer', async () => {
    const stream = 'BT /F1 24 Tf 72 700 Td (Wipod podcast studio) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    expect(await extractText(Buffer.from(pdf, 'latin1'), 'pdf')).toContain('Wipod podcast studio');
  });

  it('reads text and HTML', async () => {
    expect(await extractText(Buffer.from('سلام'), 'text')).toBe('سلام');
    const html = `<html><body><article><p>${'متن معرفی ویپاد. '.repeat(20)}</p></article></body></html>`;
    expect(await extractText(Buffer.from(html), 'html')).toContain('متن معرفی ویپاد');
  });
});

describe('fetcher: proxy routing and errors', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });
  const listen = async (handler: Parameters<typeof createServer>[1]) => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return (server.address() as AddressInfo).port;
  };
  const fetcherWith = (env: Partial<Env>) =>
    new MediaFetcherService(
      {} as PrismaService,
      {
        FETCH_TIMEOUT_MS: 300,
        FETCH_MAX_BYTES: 1_000_000,
        FETCH_ALLOW_PRIVATE: true,
        FETCH_PROXY_HOSTS: 'ir',
        ...env,
      } as Env,
    );

  it('matches host lists', () => {
    expect(matchesHostList('podspace.ir', 'ir')).toBe(true);
    expect(matchesHostList('podspace.ir', 'com, .ir')).toBe(true);
    expect(matchesHostList('example.com', 'ir')).toBe(false);
    expect(matchesHostList('example.com', '*')).toBe(true);
    expect(matchesHostList('ir.example.com', 'ir')).toBe(false);
  });

  it('parses content-disposition file names', () => {
    expect(dispositionFileName(`attachment; filename*=UTF-8''%D9%88%DB%8C.pdf`)).toBe('وی.pdf');
    expect(dispositionFileName('attachment; filename="a b.txt"')).toBe('a b.txt');
    expect(dispositionFileName(null)).toBeNull();
  });

  it('explains a host that never answers', async () => {
    const port = await listen(() => undefined); // accepts, never answers
    await expect(fetcherWith({}).getJson(`http://127.0.0.1:${port}/x`)).rejects.toThrow(
      /127\.0\.0\.1 did not answer within 1 seconds/,
    );
  });

  it('sends matching hosts through FETCH_PROXY_URL', async () => {
    const target = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ host: req.headers.host, path: req.url }));
    });
    // A CONNECT proxy (what undici speaks) that tunnels every host to the local target.
    const tunnels: string[] = [];
    const proxy = createServer();
    servers.push(proxy);
    proxy.on('connect', (req, client) => {
      tunnels.push(req.url ?? '');
      const upstream = connect(target, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client);
        client.pipe(upstream);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    const proxyPort = (proxy.address() as AddressInfo).port;

    const fetcher = fetcherWith({ FETCH_PROXY_URL: `http://127.0.0.1:${proxyPort}` });
    expect(fetcher.usesProxy('podspace.ir')).toBe(true);
    expect(fetcher.usesProxy('example.com')).toBe(false);
    await expect(fetcher.getJson('http://files.podspace.ir/api/x')).resolves.toEqual({
      host: 'files.podspace.ir',
      path: '/api/x',
    });
    expect(tunnels).toEqual(['files.podspace.ir:80']);
  });

  it('hints at FETCH_PROXY_URL for unreachable Iranian hosts', async () => {
    const message = await fetcherWith({})
      .getJson('http://nothing.invalid.ir/x')
      .catch((e: Error) => e.message);
    // Depending on the network's DNS, the lookup either fails fast ("Could not connect") or
    // hangs until the timeout ("did not answer"); both must carry the proxy hint.
    expect(message).toMatch(
      /(Could not connect to nothing\.invalid\.ir|nothing\.invalid\.ir did not answer within).*FETCH_PROXY_URL/,
    );
  });

  it('refuses downloads over the limit', async () => {
    const port = await listen((_req, res) => res.end(Buffer.alloc(2000)));
    await expect(
      fetcherWith({}).download(`http://127.0.0.1:${port}/f`, { maxBytes: 1000 }),
    ).rejects.toThrow(/larger than/);
  });
});
