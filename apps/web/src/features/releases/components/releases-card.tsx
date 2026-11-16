import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useT } from '@/i18n';
import { formatDate } from '@/utils/format';
import { RELEASES } from '../releases';

/** Version history: latest version in the header, then every release with its date and short changes. */
export function ReleasesCard() {
  const t = useT();
  const latest = RELEASES[0];
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={t('account.releases.title')}
        description={t('account.releases.hint')}
        descriptionAsTip
        actions={
          latest && (
            <Badge tone="primary">
              {t('account.releases.latest')}: <span dir="ltr">{latest.version}</span>
            </Badge>
          )
        }
      />
      <CardBody className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th scope="col" className="pb-2 pe-3 text-start font-semibold">
                {t('account.releases.version')}
              </th>
              <th scope="col" className="px-3 pb-2 text-start font-semibold">
                {t('account.releases.date')}
              </th>
              <th scope="col" className="ps-3 pb-2 text-start font-semibold">
                {t('account.releases.changes')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {RELEASES.map((r) => (
              <tr key={r.version} className="align-top">
                <td className="whitespace-nowrap py-2.5 pe-3 font-semibold" dir="ltr">
                  {r.version}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {formatDate(r.date, false)}
                </td>
                <td className="py-2.5 ps-3">
                  <ul className="list-inside list-disc space-y-0.5">
                    {r.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
