import { AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export function MainErrorFallback() {
  const t = useT();
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-3 text-center"
      role="alert"
    >
      <AlertOctagon className="size-10 text-destructive" />
      <h2 className="text-lg font-semibold">{t('common.crashTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('common.crashBody')}</p>
      <Button onClick={() => window.location.assign(window.location.origin)}>
        {t('common.reload')}
      </Button>
    </div>
  );
}
