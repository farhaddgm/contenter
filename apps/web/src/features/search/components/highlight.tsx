import { highlightParts } from '@contenter/shared';

/** `text` with the searched words marked; matching ignores the Arabic/Persian spelling differences. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-warning/30 px-0.5 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
