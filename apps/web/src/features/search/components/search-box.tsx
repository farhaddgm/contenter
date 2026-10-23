import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
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
    <>
      <form
        onSubmit={submit}
        role="search"
        className="relative hidden min-w-0 max-w-md flex-1 sm:block"
      >
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          data-bidi=""
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          className="h-10 w-full truncate rounded-full border border-input bg-card ps-10 pe-10 text-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground/75 hover:border-ring/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
        />
        <kbd
          className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground lg:block"
          aria-hidden="true"
        >
          /
        </kbd>
      </form>
      <Link
        to={paths.app.search.getHref()}
        aria-label={t('search.title')}
        className="ms-auto flex size-10 items-center justify-center rounded-full border bg-card text-muted-foreground transition hover:border-ring/60 hover:text-foreground sm:hidden"
      >
        <Search className="size-4" />
      </Link>
    </>
  );
}
