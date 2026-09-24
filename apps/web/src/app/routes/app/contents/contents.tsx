import { PageHeader } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { ContentsTable } from '@/features/contents/components/contents-table';

export default function ContentsRoute() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('contents.title')} description={t('contents.subtitle')} />
      <ContentsTable />
    </>
  );
}
