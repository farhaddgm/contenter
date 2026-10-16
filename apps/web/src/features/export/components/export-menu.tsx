import { useState } from 'react';
import { Download } from 'lucide-react';
import { EXPORT_MAX_ITEMS, ExportFormat, type ExportContentsInput } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Switch } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatNumber } from '@/utils/format';
import { useExportContents } from '../api/export';

/** What to export: these contents, or everything a list filter matches. */
export type ExportScope =
  { ids: string[] } | { filter: NonNullable<ExportContentsInput['filter']> };

/**
 * "Export" (docs/55-bulk-export.md): the current version of a content, or of every content a
 * filter matches, as Markdown, CSV, DOCX or a ZIP of all three. Everything is made by code on the
 * server from what the person may see.
 */
export function ExportMenu({
  scope,
  size = 'default',
}: {
  scope: ExportScope;
  size?: 'default' | 'sm';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size={size} icon={<Download />} onClick={() => setOpen(true)}>
        {t('export.button')}
      </Button>
      {open && <ExportDialog scope={scope} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Mounted only while open, so the choices start fresh every time without an effect. */
function ExportDialog({ scope, onClose }: { scope: ExportScope; onClose: () => void }) {
  const t = useT();
  const exportContents = useExportContents();
  const single = 'ids' in scope && scope.ids.length === 1;
  const [format, setFormat] = useState<ExportFormat>(single ? 'docx' : 'zip');
  const [onlyApproved, setOnlyApproved] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('export.title')}
      description={
        single ? t('export.single') : t('export.many', { max: formatNumber(EXPORT_MAX_ITEMS) })
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Download />}
            isLoading={exportContents.isPending}
            onClick={() =>
              exportContents.mutate({ ...scope, format, onlyApproved } as ExportContentsInput, {
                onSuccess: (name) => {
                  notify.success(t('export.done', { name }));
                  onClose();
                },
                onError: (e) => notify.error(t('common.error'), e.message),
              })
            }
          >
            {t('export.download')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('export.format')} hint={t(`export.formatHint.${format}`)}>
          {(id) => (
            <Select
              id={id}
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              options={ExportFormat.map((f) => ({ value: f, label: t(`export.formats.${f}`) }))}
            />
          )}
        </Field>
        <Switch
          checked={onlyApproved}
          onCheckedChange={setOnlyApproved}
          label={t('export.onlyApproved')}
        />
        <p className="text-xs leading-5 text-muted-foreground">{t('export.note')}</p>
      </div>
    </Dialog>
  );
}
