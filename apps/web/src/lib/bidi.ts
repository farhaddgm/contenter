/**
 * Text direction for mixed Persian/English text.
 *
 * `data-bidi=""` follows the FIRST strong character, so a Persian sentence that starts with an English
 * word is laid out left-to-right (English on the left, the Persian tail to its right). Here a block is
 * RTL as soon as it contains any Arabic-script letter, and LTR only when it is Latin-only.
 * Elements opt in with `data-bidi`; `installBidi()` keeps their `dir` up to date.
 */
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;

export type TextDir = 'rtl' | 'ltr';

export function textDir(text: string, fallback: TextDir = 'rtl'): TextDir {
  if (ARABIC_SCRIPT.test(text)) return 'rtl';
  if (LATIN.test(text)) return 'ltr';
  return fallback;
}

/** Elements that follow the rule above: explicit `data-bidi` plus the blocks of rendered Markdown. */
const SELECTOR =
  '[data-bidi], .prose-content :is(p, li, h1, h2, h3, h4, h5, h6, blockquote, th, td)';

function textOf(el: Element): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.value || el.placeholder
    : (el.textContent ?? '');
}

function apply(el: Element) {
  const dir = textDir(textOf(el), document.documentElement.dir === 'ltr' ? 'ltr' : 'rtl');
  if (el.getAttribute('dir') !== dir) el.setAttribute('dir', dir);
}

function applyAll(root: ParentNode = document) {
  root.querySelectorAll(SELECTOR).forEach(apply);
}

export function installBidi(): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      applyAll();
    });
  };
  const onInput = (e: Event) => {
    const el = e.target;
    if (el instanceof Element && el.matches(SELECTOR)) apply(el);
  };
  // `dir` itself is not observed, so our own writes never retrigger the observer.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', onInput, true);
  applyAll();
  return () => {
    observer.disconnect();
    document.removeEventListener('input', onInput, true);
    if (frame) cancelAnimationFrame(frame);
  };
}
