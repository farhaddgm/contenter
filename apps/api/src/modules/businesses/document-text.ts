import { assetFileType } from '@contenter/shared';
import { parseHtml } from '../samples/media-parser';

/** What a downloaded file is, as far as reading it goes. */
export type DocumentKind = 'text' | 'html' | 'pdf' | 'docx' | 'image' | 'video';

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'srt', 'vtt'];

const extOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';

/**
 * Classifies a file by its name (and content type, when the name has no extension). Null = not
 * readable at all (archives, Office formats other than .docx, …).
 */
export function documentKind(fileName: string, contentType = ''): DocumentKind | null {
  const ext = extOf(fileName);
  const type = contentType.toLowerCase();
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  const media = assetFileType(fileName);
  if (media) return media;
  if (ext) return null;
  if (type.startsWith('text/html')) return 'html';
  if (type.startsWith('text/') || type.includes('json')) return 'text';
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('wordprocessingml')) return 'docx';
  return null;
}

/** True for kinds that become a text reference (the rest are brand assets or unreadable). */
export const isTextKind = (kind: DocumentKind | null) =>
  kind === 'text' || kind === 'html' || kind === 'pdf' || kind === 'docx';

/** Plain text of a text-like file. Pure code; throws when the file is damaged. */
export async function extractText(buffer: Buffer, kind: DocumentKind, url = ''): Promise<string> {
  switch (kind) {
    case 'text':
      return new TextDecoder('utf-8').decode(buffer);
    case 'html':
      return (
        parseHtml(new TextDecoder('utf-8').decode(buffer), url || 'https://example.com/').media
          .text ?? ''
      );
    case 'pdf': {
      const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await pdfText(pdf, { mergePages: true });
      return text;
    }
    case 'docx': {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ buffer })).value;
    }
    default:
      return '';
  }
}
