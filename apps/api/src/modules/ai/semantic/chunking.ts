import { createHash } from 'node:crypto';

/** Characters per chunk and the overlap between neighbours; a few paragraphs of prose. */
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 150;
/** A reference is cut into at most this many chunks (the rest is not indexed). */
export const MAX_CHUNKS_PER_REFERENCE = 400;

/**
 * Cuts a text into chunks of about `size` characters. Cuts fall on paragraph ends, then on
 * sentence ends (including the Persian «؟» «.» «!»), and only inside a word as a last resort;
 * each chunk starts with the tail of the one before it so a sentence on the border is not lost.
 * Pure: the same text always gives the same chunks.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS_PER_REFERENCE) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) end = cutPoint(clean, start, end);
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    // step back by the overlap, but always move forward
    start = Math.max(end - overlap, start + 1);
    // do not start in the middle of a word
    while (start < end && !/\s/.test(clean[start - 1] ?? ' ')) start += 1;
  }
  return chunks;
}

/** The best place to cut in the last part of `[start, end)`: paragraph, sentence, then space. */
function cutPoint(text: string, start: number, end: number): number {
  const floor = start + Math.floor((end - start) * 0.5);
  const window = text.slice(floor, end);
  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph >= 0) return floor + paragraph + 2;
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('؟ '),
    window.lastIndexOf('! '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('؟\n'),
    window.lastIndexOf('\n'),
  );
  if (sentence >= 0) return floor + sentence + 2;
  const space = window.lastIndexOf(' ');
  return space >= 0 ? floor + space + 1 : end;
}

/** A short fingerprint of a text; chunks remember it to tell when their reference changed. */
export const hashText = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);
