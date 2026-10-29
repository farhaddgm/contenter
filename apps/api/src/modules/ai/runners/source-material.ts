/**
 * The text the proposal jobs (offerings, audiences) show the model and check its quotes against.
 * Each block is cut before it is sent, and `texts` holds exactly what was sent, so a quote is
 * checked against the cut text and never against something the model did not see.
 */

/** Text of one profile section sent to the model, at most. */
export const SECTION_CHARS = 8_000;
/** Key facts sent, at most. */
export const FACTS_CHARS = 6_000;
/** Reference text sent, shared equally between the references. */
export const REFERENCES_CHARS = 60_000;

export interface SourceMaterial {
  /** Profile sections to read, in order: `[S1]`, `[S2]` … */
  sections: { title: string; text: string }[];
  facts: { label: string; value: string }[];
  references: { title: string; url: string; content: string }[];
}

export interface SourceBlocks {
  /** The labelled blocks, ready to join into the prompt. */
  blocks: string[];
  /** The bare texts, for checking quotes. */
  texts: string[];
}

export function sourceBlocks(material: SourceMaterial): SourceBlocks {
  const texts: string[] = [];
  const blocks: string[] = [];
  const add = (head: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    texts.push(body);
    blocks.push(`${head}\n${body}`);
  };
  material.sections.forEach((s, i) => add(`[S${i + 1}] ${s.title}`, s.text.slice(0, SECTION_CHARS)));
  add(
    `[S${material.sections.length + 1}] Key facts`,
    material.facts
      .map((f) => `${f.label}: ${f.value}`)
      .join('\n')
      .slice(0, FACTS_CHARS),
  );
  const share = Math.max(2_000, Math.floor(REFERENCES_CHARS / Math.max(1, material.references.length)));
  material.references.forEach((r, i) =>
    add(`[R${i + 1}] ${r.title || r.url || 'Untitled'}${r.url ? ` — ${r.url}` : ''}`, r.content.slice(0, share)),
  );
  return { blocks, texts };
}
