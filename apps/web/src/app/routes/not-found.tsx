import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { paths } from '@/config/paths';
import { useT } from '@/i18n';

export function NotFoundRoute() {
  const t = useT();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-6xl font-black text-primary/30">404</p>
      <h1 className="text-xl font-bold">{t('common.notFound')}</h1>
      <p className="text-sm text-muted-foreground">{t('common.notFoundBody')}</p>
      <Button asChild>
        <Link to={paths.app.dashboard.getHref()} replace>
          {t('common.goHome')}
        </Link>
      </Button>
    </div>
  );
}
