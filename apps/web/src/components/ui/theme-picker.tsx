import { Check } from 'lucide-react';
import { useT } from '@/i18n';
import { THEMES, useUi, type Theme } from '@/stores/ui';
import { cn } from '@/utils/cn';

/** [sidebar, primary, page] — what each palette looks like, for the swatch. */
const PREVIEW: Record<Theme, [string, string, string]> = {
  system: ['#4a2c10', '#a35c05', '#17100a'],
  honey: ['#4a2c10', '#a35c05', '#fffaf0'],
  light: ['#10234b', '#2457d6', '#f6f8fb'],
  dark: ['#120c06', '#f0a93a', '#17100a'],
  forest: ['#123f35', '#19735b', '#f3faf7'],
  slate: ['#26364e', '#5b6b80', '#f5f7fa'],
  blackyellow: ['#171717', '#edcb00', '#f7f4e8'],
  red: ['#7d1f35', '#c4384d', '#fff4f6'],
};

export function ThemeSwatch({ theme, className }: { theme: Theme; className?: string }) {
  const [a, b, c] = PREVIEW[theme];
  return (
    <span
      aria-hidden
      className={cn('inline-block size-6 shrink-0 rounded-full border border-black/15', className)}
      style={{
        background:
          theme === 'system'
            ? `linear-gradient(135deg, #fffaf0 50%, #17100a 50%)`
            : `linear-gradient(135deg, ${a} 0 38%, ${b} 38% 70%, ${c} 70%)`,
      }}
    />
  );
}

/** All palettes as a radio group (Account → Appearance). */
export function ThemePicker() {
  const t = useT();
  const { theme, setTheme } = useUi();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.title')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {THEMES.map((value) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border-2 bg-card p-3 text-start text-sm font-semibold transition-colors hover:bg-muted',
              active ? 'border-primary' : 'border-border',
            )}
          >
            <ThemeSwatch theme={value} className="size-7" />
            <span className="min-w-0 flex-1 truncate">{t(`theme.${value}`)}</span>
            {active && <Check className="size-4 text-primary" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
