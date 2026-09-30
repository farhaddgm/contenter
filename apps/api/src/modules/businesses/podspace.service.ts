import { Injectable, Logger } from '@nestjs/common';
import { podSpaceUrl, type PodSpaceLink } from '@contenter/shared';
import { FetchError, MediaFetcherService } from '../samples/media-fetcher.service';
import { documentKind, type DocumentKind } from './document-text';

/** The public API of PodSpace lives on the share host; the legacy host serves the same API. */
const LEGACY_ORIGIN = 'https://podspace.pod.ir';
const PAGE_SIZE = 100;
const FOLDER_DEPTH = 4;
/** Entries listed per folder link (all subfolders together), so a huge share cannot stall a request. */
const MAX_ENTRIES = 400;
const HEADERS = { 'ps-client': 'BROWSER', 'accept-language': 'fa-IR,fa;q=0.9' };

export interface PodSpaceEntry {
  hash: string;
  name: string;
  /** Path inside the shared folder, e.g. `Posts/Spring/cover.jpg`. */
  path: string;
  kind: DocumentKind | null;
  size: number | null;
  /** Canonical link of the file (what a reference or asset stores). */
  url: string;
}

export interface PodSpaceFolder {
  name: string;
  files: PodSpaceEntry[];
  /** More entries exist than MAX_ENTRIES (or deeper than FOLDER_DEPTH). */
  truncated: boolean;
}

/** One item of a `folders/{hash}/children` answer (only the fields used here). */
interface RawEntry {
  hash?: string;
  name?: string;
  type?: string;
  extension?: string;
  size?: number;
  isFolder?: boolean;
}

/** `{ result: { list, count, entity } }` is the documented shape; tolerate close variants. */
export function parseChildren(body: unknown): {
  entries: RawEntry[];
  count: number | null;
  name: string | null;
} | null {
  const root = (body ?? {}) as Record<string, unknown>;
  const result = (root.result ?? root.data ?? root) as Record<string, unknown> | unknown[];
  const list = Array.isArray(result)
    ? result
    : ((result.list ?? result.children ?? result.items ?? result.files) as unknown);
  if (!Array.isArray(list)) return null;
  const meta = Array.isArray(result) ? {} : result;
  const entity = (meta.entity ?? meta.folder) as { name?: string } | undefined;
  return {
    entries: list.filter((e): e is RawEntry => !!e && typeof e === 'object'),
    count: typeof meta.count === 'number' ? meta.count : null,
    name: entity?.name ?? null,
  };
}

export const isFolderEntry = (e: RawEntry) =>
  e.isFolder === true || /folder|directory/i.test(e.type ?? '');

/**
 * Reads public ("anyone with the link") PodSpace shares — Fanap's cloud storage
 * (podspace.ir). The share page is a JavaScript app, so the folder tree and the files are read
 * through the PodSpace REST API (`folders/{hash}/children`, `files/{hash}`), passing the
 * link's `shareHash`. Goes through MediaFetcherService, so SSRF rules and FETCH_PROXY_URL
 * (PodSpace does not answer servers outside Iran) apply. Pure code, no AI.
 */
@Injectable()
export class PodSpaceService {
  private readonly logger = new Logger(PodSpaceService.name);

  constructor(private readonly fetcher: MediaFetcherService) {}

  private apiBases(link: PodSpaceLink) {
    return [...new Set([`${link.origin}/api`, `${LEGACY_ORIGIN}/api`])];
  }

  private query(link: PodSpaceLink, extra: Record<string, string | number> = {}) {
    const q = new URLSearchParams(Object.entries(extra).map(([k, v]) => [k, String(v)]));
    if (link.shareHash) q.set('shareHash', link.shareHash);
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  /**
   * Tries each API host until one answers; the error lists every attempt so a changed API is
   * easy to diagnose from the reference's error text.
   */
  private async firstWorking<T>(
    link: PodSpaceLink,
    paths: string[],
    attempt: (url: string) => Promise<T>,
  ): Promise<T> {
    const tried: string[] = [];
    let timedOut: FetchError | null = null;
    for (const base of this.apiBases(link)) {
      for (const path of paths) {
        const url = `${base}${path}`;
        try {
          return await attempt(url);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (
            err instanceof FetchError &&
            /did not answer within|Could not connect/.test(message)
          ) {
            timedOut ??= err;
          }
          tried.push(`${url.replace(/shareHash=[^&]+/, 'shareHash=…')} → ${message}`);
        }
      }
    }
    // A host that never answers is the whole story; the attempt list would hide it.
    if (timedOut) throw timedOut;
    this.logger.warn(`PodSpace ${link.kind} ${link.hash}: ${tried.join(' | ')}`);
    throw new FetchError(`PodSpace could not be read. Tried: ${tried.join('; ')}`);
  }

  /** One page of a folder's children. */
  private children(link: PodSpaceLink, hash: string, start: number) {
    const q = this.query(link, {
      start,
      size: PAGE_SIZE,
      breadcrumb: 'true',
      order: 'name',
      desc: 'false',
    });
    return this.firstWorking(link, [`/folders/${hash}/children${q}`], async (url) => {
      const page = parseChildren(await this.fetcher.getJson(url, HEADERS));
      if (!page) throw new FetchError('the answer has no file list');
      return page;
    });
  }

  /**
   * Lists every file of a shared folder, subfolders included (breadth first, up to
   * FOLDER_DEPTH levels and MAX_ENTRIES entries).
   */
  async listFolder(link: PodSpaceLink): Promise<PodSpaceFolder> {
    if (!link.shareHash) {
      throw new FetchError(
        'This PodSpace link has no shareHash, so it is private. In PodSpace, share the folder with "anyone with the link" and copy that link.',
      );
    }
    const files: PodSpaceEntry[] = [];
    let name: string | null = null;
    let truncated = false;
    let seen = 0;
    const queue: { hash: string; path: string; depth: number }[] = [
      { hash: link.hash, path: '', depth: 0 },
    ];
    const visited = new Set<string>();
    while (queue.length) {
      const folder = queue.shift()!;
      if (visited.has(folder.hash)) continue;
      visited.add(folder.hash);
      for (let start = 0; ; start += PAGE_SIZE) {
        const page = await this.children(link, folder.hash, start);
        if (folder.depth === 0) name ??= page.name;
        for (const e of page.entries) {
          if (!e.hash) continue;
          if (++seen > MAX_ENTRIES) {
            truncated = true;
            break;
          }
          const entryName = (e.name ?? e.hash).trim();
          const path = folder.path ? `${folder.path}/${entryName}` : entryName;
          if (isFolderEntry(e)) {
            if (folder.depth + 1 < FOLDER_DEPTH) {
              queue.push({ hash: e.hash, path, depth: folder.depth + 1 });
            } else truncated = true;
            continue;
          }
          const fileName =
            e.extension && !entryName.toLowerCase().endsWith(`.${e.extension.toLowerCase()}`)
              ? `${entryName}.${e.extension}`
              : entryName;
          files.push({
            hash: e.hash,
            name: fileName,
            path: folder.path ? `${folder.path}/${fileName}` : fileName,
            kind: documentKind(fileName, e.type ?? ''),
            size: typeof e.size === 'number' ? e.size : null,
            url: podSpaceUrl({ ...link, kind: 'file', hash: e.hash }),
          });
        }
        if (truncated || page.entries.length < PAGE_SIZE) break;
        if (page.count !== null && start + PAGE_SIZE >= page.count) break;
      }
      if (truncated) break;
    }
    return { name: name ?? 'PodSpace', files, truncated };
  }

  /** Downloads one shared file. */
  download(link: PodSpaceLink, maxBytes: number) {
    const q = this.query(link);
    return this.firstWorking(
      link,
      [`/files/${link.hash}${q}`, `/v2/files/${link.hash}${q}`],
      (url) => this.fetcher.download(url, { maxBytes, headers: HEADERS }),
    );
  }
}
