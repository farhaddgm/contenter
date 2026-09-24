import { useState, type ReactElement, type ReactNode, cloneElement } from 'react';
import { useT } from '@/i18n';
import { Button } from './button';
import { Dialog } from './dialog';

/** Wraps a trigger element; asks for confirmation before running `onConfirm`. */
export function ConfirmationDialog({
  trigger,
  title,
  body,
  confirmLabel,
  tone = 'destructive',
  onConfirm,
  isLoading,
}: {
  trigger: ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  title?: ReactNode;
  body?: ReactNode;
  confirmLabel?: ReactNode;
  tone?: 'destructive' | 'default';
  onConfirm: () => Promise<unknown> | void;
  isLoading?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {cloneElement(trigger, {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          setOpen(true);
        },
      })}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title ?? t('common.deleteConfirmTitle')}
        description={body ?? t('common.deleteConfirmBody')}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={tone}
              isLoading={isLoading}
              onClick={async () => {
                await onConfirm();
                setOpen(false);
              }}
            >
              {confirmLabel ?? t('common.delete')}
            </Button>
          </>
        }
      />
    </>
  );
}
