import { Switch } from '@/components/ui/form-controls';
import { useT } from '@/i18n';

/**
 * Economy mode (docs/60-reliability-and-cost.md): the model call goes to the vendor's batch
 * API — about half the price, but the result may take up to 24 hours.
 */
export function EconomyToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-3">
      <Switch checked={checked} onCheckedChange={onChange} label={t('contents.economy.label')} />
      <p className="text-xs leading-5 text-muted-foreground">
        {checked ? t('contents.economy.on') : t('contents.economy.off')}
      </p>
    </div>
  );
}
