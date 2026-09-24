import { useCallback } from 'react';
import { useUi, type Lang } from '@/stores/ui';
import { en } from './en';
import { fa, type Dictionary } from './fa';

const dictionaries: Record<Lang, unknown> = { fa, en };

/** Dot-paths to every string leaf of the dictionary, e.g. "topics.fields.title". */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<Dictionary>;
export type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

function lookup(lang: Lang, key: string): string {
  const read = (dict: unknown) =>
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
  const v = read(dictionaries[lang]) ?? read(fa);
  return typeof v === 'string' ? v : key;
}

export function translate(lang: Lang, key: TranslationKey, vars?: Record<string, string | number>) {
  const raw = lookup(lang, key);
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
}

export function useT(): TFn {
  const lang = useUi((s) => s.lang);
  return useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
}

export const isRtl = (lang: Lang) => lang === 'fa';
