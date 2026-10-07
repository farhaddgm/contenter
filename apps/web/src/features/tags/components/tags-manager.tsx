import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { CreateTagSchema, TagColor, type CreateTagInput, type Tag } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form-controls';
import { EmptyState } from '@/components/ui/table';
import { PageSpinner } from '@/components/ui/spinner';
import { useT } from '@/i18n';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/format';
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '../api/tags';
import { TagChip, tagSwatchClass } from './tag-chip';

/** Mounted only while open, so the form starts from the tag it edits without a reset effect. */
function TagFormDialog({
  topicId,
  tag,
  onOpenChange,
}: {
  topicId: string;
  tag?: Tag;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateTag(topicId);
  const update = useUpdateTag();
  const form = useForm<CreateTagInput>({
    resolver: zodResolver(CreateTagSchema),
    defaultValues: { name: tag?.name ?? '', color: tag?.color ?? 'slate' },
  });
  const onSuccess = () => {
    notify.success(t('common.saved'));
    onOpenChange(false);
  };
  const onError = (e: Error) => notify.error(t('common.error'), e.message);
  const submit = form.handleSubmit((values) =>
    tag
      ? update.mutate({ id: tag.id, data: values }, { onSuccess, onError })
      : create.mutate(values, { onSuccess, onError }),
  );
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={tag ? t('tags.edit') : t('tags.new')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="tag-form" isLoading={create.isPending || update.isPending}>
            {tag ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form id="tag-form" onSubmit={submit} className="space-y-4">
        <Field label={t('tags.name')} error={form.formState.errors.name?.message}>
          {(id) => <Input id={id} dir="auto" autoFocus {...form.register('name')} />}
        </Field>
        <Controller
          control={form.control}
          name="color"
          render={({ field }) => (
            <Field label={t('tags.color')}>
              {() => (
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label={t('tags.color')}
                >
                  {TagColor.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={field.value === c}
                      aria-label={c}
                      onClick={() => field.onChange(c)}
                      className={cn(
                        'size-7 rounded-full ring-offset-2 ring-offset-card transition',
                        tagSwatchClass[c],
                        field.value === c ? 'ring-2 ring-foreground' : 'hover:scale-110',
                      )}
                    />
                  ))}
                </div>
              )}
            </Field>
          )}
        />
      </form>
    </Dialog>
  );
}

/** Create, rename, recolor and delete the tags of one topic. */
export function TagsManager({ topicId }: { topicId: string }) {
  const t = useT();
  const editable = useCanEditTopic(topicId);
  const { data: tags, isLoading } = useTags(topicId);
  const remove = useDeleteTag();
  const dialog = useDisclosure();

  // the tag the open dialog edits; undefined = a new one
  const [edited, setEdited] = useState<Tag | undefined>(undefined);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Tags className="size-4" />
            {t('tags.title')}
          </span>
        }
        description={t('tags.subtitle')}
        actions={
          editable && (
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() => {
                setEdited(undefined);
                dialog.open();
              }}
            >
              {t('tags.new')}
            </Button>
          )
        }
      />
      {isLoading ? (
        <PageSpinner />
      ) : !tags?.length ? (
        <EmptyState icon={<Tags />} title={t('tags.empty')} />
      ) : (
        <ul className="divide-y">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <TagChip tag={tag} className="max-w-60" />
              <span className="flex-1 text-xs text-muted-foreground">
                {t('tags.usage', {
                  contents: formatNumber(tag._count?.contents ?? 0),
                  ideas: formatNumber(tag._count?.ideas ?? 0),
                })}
              </span>
              {editable && (
                <span className="flex items-center gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('common.edit')}
                    onClick={() => {
                      setEdited(tag);
                      dialog.open();
                    }}
                  >
                    <Pencil />
                  </Button>
                  <ConfirmationDialog
                    trigger={
                      <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    }
                    body={t('tags.deleteBody')}
                    onConfirm={() => remove.mutateAsync(tag.id)}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog.isOpen && (
        <TagFormDialog topicId={topicId} tag={edited} onOpenChange={dialog.setIsOpen} />
      )}
    </Card>
  );
}
