import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpen, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  BRAND_DOC_MAX_CHARS,
  BRAND_DOCS_PROMPT_CHARS,
  BrandDocKind,
  CreateBrandDocSchema,
  type BrandDocument,
  type CreateBrandDocInput,
} from '@contenter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useCanEditTopic } from '@/features/topics/api/topics';
import { useDisclosure } from '@/hooks/use-disclosure';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';
import {
  useBrandDoc,
  useBrandDocs,
  useCreateBrandDoc,
  useDeleteBrandDoc,
  useUpdateBrandDoc,
} from '../api/brand-docs';

const TEXT_FILE = /\.(txt|md|markdown)$/i;

function BrandDocForm({
  topicId,
  doc,
  onOpenChange,
}: {
  topicId: string;
  doc?: BrandDocument;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const create = useCreateBrandDoc(topicId);
  const update = useUpdateBrandDoc();
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useForm<CreateBrandDocInput>({
    resolver: zodResolver(CreateBrandDocSchema),
    defaultValues: {
      kind: doc?.kind ?? 'BRAND_BOOK',
      title: doc?.title ?? '',
      content: doc?.content ?? '',
      fileName: doc?.fileName ?? null,
      isActive: doc?.isActive ?? true,
    },
  });
  const fileName = useWatch({ control: form.control, name: 'fileName' });
  const errors = form.formState.errors;
  const pending = create.isPending || update.isPending;

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!TEXT_FILE.test(file.name) && !file.type.startsWith('text/')) {
      notify.error(t('common.error'), t('brandDocs.unsupportedFile'));
      return;
    }
    const text = await file.text();
    if (text.length > BRAND_DOC_MAX_CHARS) {
      notify.error(
        t('common.error'),
        t('brandDocs.tooLong', { max: formatNumber(BRAND_DOC_MAX_CHARS) }),
      );
      return;
    }
    form.setValue('content', text, { shouldValidate: true, shouldDirty: true });
    form.setValue('fileName', file.name, { shouldDirty: true });
    if (!form.getValues('title').trim())
      form.setValue('title', file.name.replace(/\.[^.]+$/, ''), { shouldValidate: true });
  };

  const onSubmit = form.handleSubmit((values) => {
    const opts = {
      onSuccess: () => {
        notify.success(t('brandDocs.saved'));
        onOpenChange(false);
      },
      onError: (e: Error) => notify.error(t('common.error'), e.message),
    };
    if (doc) update.mutate({ id: doc.id, data: values }, opts);
    else create.mutate(values, opts);
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={doc ? t('brandDocs.edit') : t('brandDocs.add')}
      description={t('brandDocs.subtitle')}
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="brand-doc-form" isLoading={pending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="brand-doc-form" onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label={t('brandDocs.docTitle')} error={errors.title?.message}>
            {(id) => <Input id={id} autoFocus {...form.register('title')} />}
          </Field>
          <Field label={t('brandDocs.kind')}>
            {(id) => (
              <Select
                id={id}
                {...form.register('kind')}
                options={BrandDocKind.map((k) => ({
                  value: k,
                  label: t(`enums.brandDocKind.${k}`),
                }))}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('brandDocs.content')}
          hint={t('brandDocs.contentHint')}
          error={errors.content?.message}
        >
          {(id) => <Textarea id={id} rows={14} dir="auto" {...form.register('content')} />}
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon={<FileUp />}
              onClick={() => fileInput.current?.click()}
            >
              {t('brandDocs.upload')}
            </Button>
            {fileName && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                {fileName}
              </span>
            )}
          </div>
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <Switch
                checked={!!field.value}
                onCheckedChange={field.onChange}
                label={t('brandDocs.active')}
              />
            )}
          />
        </div>
      </form>
    </Dialog>
  );
}

/** Loads the full text before mounting the form so defaultValues are complete. */
function EditBrandDoc({
  topicId,
  id,
  onOpenChange,
}: {
  topicId: string;
  id: string;
  onOpenChange: (v: boolean) => void;
}) {
  const { data } = useBrandDoc(id);
  if (!data) return null;
  return <BrandDocForm topicId={topicId} doc={data} onOpenChange={onOpenChange} />;
}

function BrandDocRow({
  doc,
  editable,
  onEdit,
}: {
  doc: BrandDocument;
  editable: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const update = useUpdateBrandDoc();
  const remove = useDeleteBrandDoc();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{doc.title}</span>
          <Badge tone="primary">{t(`enums.brandDocKind.${doc.kind}`)}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('brandDocs.chars', { count: formatNumber(doc.chars) })} ·{' '}
          {formatDate(doc.updatedAt, false)}
          {doc.fileName && (
            <>
              {' · '}
              <span dir="ltr">{doc.fileName}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {update.isPending && <Spinner size="sm" />}
        <Switch
          checked={doc.isActive}
          disabled={!editable}
          onCheckedChange={(isActive) => update.mutate({ id: doc.id, data: { isActive } })}
          label={t('brandDocs.active')}
        />
        {editable && (
          <>
            <Button size="icon-sm" variant="ghost" aria-label={t('common.edit')} onClick={onEdit}>
              <Pencil />
            </Button>
            <ConfirmationDialog
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={t('common.delete')}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              }
              onConfirm={() => remove.mutateAsync(doc.id)}
            />
          </>
        )}
      </div>
    </li>
  );
}

/** Topic-level brand book / writing rules that are passed to the AI jobs. */
export function BrandDocsPanel({ topicId }: { topicId: string }) {
  const t = useT();
  const editable = useCanEditTopic(topicId);
  const { data, isLoading } = useBrandDocs(topicId);
  const addDialog = useDisclosure();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader
        title={t('brandDocs.title')}
        description={t('brandDocs.subtitle')}
        actions={
          editable && (
            <Button size="sm" variant="outline" icon={<Plus />} onClick={addDialog.open}>
              {t('brandDocs.add')}
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : !data?.length ? (
        <EmptyState icon={<BookOpen />} title={t('brandDocs.empty')} />
      ) : (
        <ul className="divide-y">
          {data.map((d) => (
            <BrandDocRow key={d.id} doc={d} editable={editable} onEdit={() => setEditingId(d.id)} />
          ))}
        </ul>
      )}
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        {t('brandDocs.budgetNote', { max: formatNumber(BRAND_DOCS_PROMPT_CHARS) })}
      </p>
      {addDialog.isOpen && <BrandDocForm topicId={topicId} onOpenChange={addDialog.setIsOpen} />}
      {editingId && (
        <EditBrandDoc
          topicId={topicId}
          id={editingId}
          onOpenChange={(open) => !open && setEditingId(null)}
        />
      )}
    </Card>
  );
}
