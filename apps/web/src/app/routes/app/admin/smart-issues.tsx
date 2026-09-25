import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { NotebookPen, Search, Trash2 } from 'lucide-react';
import { IssueStatus, type WalkerIssue } from '@contenter/shared';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Drawer } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { CopyButton, MarkdownView, PageHeader, Segmented } from '@/components/ui/misc';
import { EmptyState, Pagination, Table, type Column } from '@/components/ui/table';
import { useT } from '@/i18n';
import { useDebounce } from '@/hooks/use-debounce';
import { notify } from '@/stores/notifications';
import { formatDate, formatRelative } from '@/utils/format';
import { useDeleteIssue, useIssues, useUpdateIssue } from '@/features/smart/api';

const issueTone: Record<WalkerIssue['status'], BadgeTone> = {
  OPEN: 'danger',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  WONT_FIX: 'neutral',
};

/** Full Markdown report of an issue for pasting to a developer (or Claude). */
function issueReport(issue: WalkerIssue) {
  return [
    `# [Walker issue ${issue.id}] ${issue.title}`,
    '',
    `- status: ${issue.status}`,
    `- source: ${issue.source}`,
    `- created: ${issue.createdAt} by ${issue.createdBy?.name ?? '—'}`,
    issue.route ? `- page: ${issue.route}` : '',
    issue.topicId ? `- topicId: ${issue.topicId}` : '',
    issue.errorId ? `- errorId: ${issue.errorId}` : '',
    issue.conversationId ? `- conversationId: ${issue.conversationId}` : '',
    issue.context ? `- context: ${JSON.stringify(issue.context)}` : '',
    '',
    '---',
    '',
    issue.content,
    issue.resolutionNote ? `\n---\n\n## Resolution note\n${issue.resolutionNote}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function IssueDrawer({ issue, onClose }: { issue: WalkerIssue; onClose: () => void }) {
  const t = useT();
  const update = useUpdateIssue();
  const remove = useDeleteIssue();
  const [note, setNote] = useState(issue.resolutionNote ?? '');
  const [title, setTitle] = useState(issue.title);
  return (
    <Drawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={issue.title}
      description={
        <code dir="ltr" className="text-xs">
          {issue.id}
        </code>
      }
      className="max-w-3xl"
      footer={
        <>
          <ConfirmationDialog
            trigger={
              <Button variant="ghost" icon={<Trash2 />}>
                {t('common.delete')}
              </Button>
            }
            onConfirm={() => remove.mutateAsync(issue.id).then(onClose)}
          />
          <div className="flex-1" />
          <CopyButton text={issueReport(issue)} label={t('smart.issues.copyForDev')} />
          <Button
            isLoading={update.isPending}
            onClick={() =>
              update.mutate(
                { id: issue.id, data: { title, resolutionNote: note } },
                { onSuccess: () => notify.success(t('common.saved')) },
              )
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={issue.status}
            onChange={(status) => update.mutate({ id: issue.id, data: { status } })}
            options={IssueStatus.map((s) => ({
              value: s,
              label: t(`smart.issues.statusLabels.${s}`),
            }))}
          />
        </div>
        <dl className="grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('smart.issues.source')}</dt>
            <dd>{t(`smart.issues.sourceLabels.${issue.source}`)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('smart.issues.createdBy')}</dt>
            <dd>
              {issue.createdBy?.name ?? '—'} · {formatDate(issue.createdAt)}
            </dd>
          </div>
          {issue.route && (
            <div>
              <dt className="text-muted-foreground">{t('smart.issues.page')}</dt>
              <dd dir="ltr" className="text-start">
                {issue.route}
              </dd>
            </div>
          )}
          {issue.errorId && (
            <div>
              <dt className="text-muted-foreground">{t('smart.issues.relatedError')}</dt>
              <dd dir="ltr" className="text-start">
                {issue.errorId}
              </dd>
            </div>
          )}
        </dl>
        <Field label={t('topics.fields.title')}>
          {(id) => (
            <Input id={id} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <Card className="p-4">
          <MarkdownView>{issue.content}</MarkdownView>
        </Card>
        <Field label={t('smart.issues.resolutionNote')} optional={t('common.optional')}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              dir="auto"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Drawer>
  );
}

export default function SmartIssuesRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof IssueStatus)[number] | ''>('');
  const debouncedQ = useDebounce(q);
  const { data, isLoading } = useIssues({ page, q: debouncedQ, status });
  const selected = data?.items.find((i) => i.id === params.get('id')) ?? null;

  const select = (id: string | null) => {
    if (id) params.set('id', id);
    else params.delete('id');
    setParams(params, { replace: true });
  };

  const columns: Column<WalkerIssue>[] = [
    {
      key: 'status',
      header: t('common.status'),
      cell: (i) => (
        <Badge tone={issueTone[i.status]}>{t(`smart.issues.statusLabels.${i.status}`)}</Badge>
      ),
    },
    {
      key: 'title',
      header: t('topics.fields.title'),
      cell: (i) => (
        <p className="line-clamp-2 min-w-64 max-w-xl font-medium" dir="auto">
          {i.title}
        </p>
      ),
    },
    {
      key: 'source',
      header: t('smart.issues.source'),
      cell: (i) => t(`smart.issues.sourceLabels.${i.source}`),
    },
    {
      key: 'by',
      header: t('smart.issues.createdBy'),
      cell: (i) => <span className="text-xs">{i.createdBy?.name ?? '—'}</span>,
    },
    {
      key: 'created',
      header: t('common.createdAt'),
      cell: (i) => (
        <span className="text-xs text-muted-foreground">{formatRelative(i.createdAt)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('smart.issues.title')} description={t('smart.issues.subtitle')} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full max-w-xs">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t('common.search')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Segmented
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: '' as const, label: t('common.all') },
              ...IssueStatus.map((s) => ({ value: s, label: t(`smart.issues.statusLabels.${s}`) })),
            ]}
          />
        </div>
        <Table
          data={data?.items}
          columns={columns}
          isLoading={isLoading}
          onRowClick={(i) => select(i.id)}
          empty={
            <EmptyState
              icon={<NotebookPen />}
              title={t('smart.issues.empty')}
              description={t('smart.issues.emptyHint')}
            />
          }
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
      {selected && <IssueDrawer key={selected.id} issue={selected} onClose={() => select(null)} />}
    </>
  );
}
