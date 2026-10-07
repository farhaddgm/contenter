import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';
import { MIN_SEARCH_LENGTH } from '../api/search';

/** The search field of the top bar: Enter opens the results page; "/" focuses it. */
export function SearchBox() {
  const t = useT();
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q.length < MIN_SEARCH_LENGTH) return;
    navigate(paths.app.search.getHref(q));
    ref.current?.blur();
  };

  return (
    <form onSubmit={submit} role="search" className="relative hidden w-56 sm:block lg:w-72">
      <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.title')}
        className="h-9 w-full rounded-full border border-input bg-card ps-9 pe-8 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      <kbd className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 rounded border px-1.5 text-[10px] text-muted-foreground lg:block">
        /
      </kbd>
    </form>
  );
}
