import { PageHeader } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { PrinciplesList } from '@/features/principles/components/principles-list';

export default function GlobalPrinciplesRoute() {
  const t = useT();
  return (
    <>
      <PageHeader
        title={t('principles.globalTitle')}
        description={t('principles.globalSubtitle')}
      />
      <PrinciplesList
        topicId={null}
        title={t('principles.globalTitle')}
        description={t('principles.subtitle')}
      />
    </>
  );
}
