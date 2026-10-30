import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/ui/misc';
import { TabBar } from '@/components/ui/tab-bar';
import { useT } from '@/i18n';
import { SmartErrorsPanel } from '@/features/smart/components/errors-panel';
import { SmartInteractionsPanel } from '@/features/smart/components/interactions-panel';
import { SmartIssuesPanel } from '@/features/smart/components/issues-panel';
import { SmartSettingsCard } from '@/features/smart/components/smart-settings-card';

const TABS = ['errors', 'issues', 'interactions', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function SmartRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = TABS.find((x) => x === raw) ?? 'errors';

  const labels: Record<Tab, string> = {
    errors: t('smart.nav.errors'),
    issues: t('smart.nav.issues'),
    interactions: t('smart.nav.interactions'),
    settings: t('smart.settings.tab'),
  };

  return (
    <>
      <PageHeader title={t('smart.name')} description={t('smart.subtitle')} />
      <TabBar
        value={tab}
        onChange={(next) => setParams({ tab: next }, { replace: true })}
        options={TABS.map((x) => ({ value: x, label: labels[x] }))}
        label={t('smart.name')}
      />
      {tab === 'errors' && <SmartErrorsPanel />}
      {tab === 'issues' && <SmartIssuesPanel />}
      {tab === 'interactions' && <SmartInteractionsPanel />}
      {tab === 'settings' && (
        <div className="max-w-3xl">
          <SmartSettingsCard />
        </div>
      )}
    </>
  );
}
