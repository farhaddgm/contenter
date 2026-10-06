import { useState } from 'react';
import { Check, Plus, Tags } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { Tag } from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { useT } from '@/i18n';
import { notify } from '@/stores/notifications';
import { cn } from '@/utils/cn';
import { useCreateTag, useTags } from '../api/tags';
import { TagChip, tagSwatchClass } from './tag-chip';

/**
 * Chips of the selected tags plus a popover to change them. `onChange` gets the full new id list,
 * so the caller persists it with one `PUT .../tags`. Typing a name that does not exist offers to
 * create it in the topic and select it in one step.
 */
export function TagPicker({
  topicId,
  selected,
  onChange,
  disabled,
}: {
  topicId: string;
  selected: Tag[];
  onChange: (tagIds: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: tags = [] } = useTags(topicId);
  const create = useCreateTag(topicId);
  const [query, setQuery] = useState('');
  const ids = selected.map((s) => s.id);
  const trimmed = query.trim();
  const shown = tags.filter((tag) => tag.name.toLowerCase().includes(trimmed.toLowerCase()));
  const exact = tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());

  const toggle = (id: string) =>
    onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const createAndSelect = () =>
    create.mutate(
      { name: trimmed },
      {
        onSuccess: (tag) => {
          setQuery('');
          onChange([...ids, tag.id]);
        },
        onError: (e) => notify.error(t('common.error'), e.message),
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {!disabled && (
        <Popover.Root onOpenChange={(open) => !open && setQuery('')}>
          <Popover.Trigger asChild>
            <Button size="sm" variant="ghost" icon={selected.length ? <Plus /> : <Tags />}>
              {selected.length ? undefined : t('tags.add')}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-64 rounded-lg border bg-card p-2 text-sm shadow-lg"
            >
              <Input
                autoFocus
                dir="auto"
                value={query}
                placeholder={t('tags.searchOrCreate')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && trimmed && !exact) {
                    e.preventDefault();
                    createAndSelect();
                  }
                }}
              />
              <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
                {shown.map((tag) => (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => toggle(tag.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-muted"
                    >
                      <span className={cn('size-2.5 rounded-full', tagSwatchClass[tag.color])} />
                      <span className="flex-1 truncate" dir="auto">
                        {tag.name}
                      </span>
                      {ids.includes(tag.id) && <Check className="size-4 text-primary" />}
                    </button>
                  </li>
                ))}
                {!shown.length && !trimmed && (
                  <li className="px-2 py-2 text-xs text-muted-foreground">{t('tags.none')}</li>
                )}
              </ul>
              {trimmed && !exact && (
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={createAndSelect}
                  className="mt-1 flex w-full items-center gap-2 rounded-md border-t px-2 py-2 text-start text-primary hover:bg-muted disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  <span dir="auto">{t('tags.create', { name: trimmed })}</span>
                </button>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
