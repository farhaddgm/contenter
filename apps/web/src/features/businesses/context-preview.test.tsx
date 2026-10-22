import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContextReport, ContextTarget } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  calls: [] as { target: string; topicId: string }[],
}));

vi.mock('./api/context-preview', () => ({
  useContextPreview: (_id: string, target: string, topicId: string) => {
    state.calls.push({ target, topicId });
    return { data: state.data, isLoading: !state.data };
  },
}));

import { ContextPreviewPanel } from './components/context-preview-panel';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const block = (id: string, text: string, over: Record<string, unknown> = {}) => ({
  id,
  text,
  chars: text.length,
  estTokens: Math.ceil(text.length / 2),
  cut: false,
  omitted: 0,
  unreviewed: false,
  ...over,
});

function report(over: Partial<ContextReport> = {}): ContextReport {
  const blocks = [
    block('HEAD', 'Name: Acme'),
    block('SECTION:OVERVIEW', '### Overview\nTea shop', { unreviewed: true }),
    block('FACTS', '### Key facts', { cut: true, omitted: 4 }),
  ] as ContextReport['blocks'];
  return {
    target: 'DRAFT' as ContextTarget,
    topicId: null,
    blocks,
    totalChars: 60,
    estTokens: 30,
    estCostUsd: 0.0004,
    model: 'anthropic:claude-opus-5-5',
    ratio: { charsPerToken: 2.5, source: 'DEFAULT', samples: 0 },
    warnings: [{ code: 'UNREVIEWED_AI', blocks: ['SECTION:OVERVIEW'], count: 1 }],
    needsTopic: true,
    ...over,
  };
}

const topics = [{ id: 't1', title: 'پروژهٔ چای' }];

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.data = report();
  state.calls = [];
});

describe('ContextPreviewPanel', () => {
  it('lists the blocks with their size and marks cut and unconfirmed ones', () => {
    render(<ContextPreviewPanel businessId="b1" topics={topics} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText(t('businesses.context.blocks.HEAD'))).toBeVisible();
    expect(within(table).getByText(t('enums.businessSection.OVERVIEW'))).toBeVisible();
    expect(within(table).getByText(t('businesses.context.unreviewed'))).toBeVisible();
    expect(within(table).getByText(t('businesses.context.omitted', { count: '۴' }))).toBeVisible();
    expect(screen.getByText(t('businesses.context.warnings.UNREVIEWED_AI', { count: '۱' }))).toBeVisible();
  });

  it('says the ratio is a default and shows the cost when the server gave one', () => {
    render(<ContextPreviewPanel businessId="b1" topics={topics} />);
    expect(screen.getByText(/نسبت پیش‌فرض/)).toBeVisible();
    expect(screen.getByText(/هزینهٔ تقریبی ورودی/)).toBeVisible();
  });

  it('shows no cost line without a cost', () => {
    state.data = report({ estCostUsd: null });
    render(<ContextPreviewPanel businessId="b1" topics={topics} />);
    expect(screen.queryByText(/هزینهٔ تقریبی ورودی/)).not.toBeInTheDocument();
  });

  it('opens the exact text of a block', async () => {
    render(<ContextPreviewPanel businessId="b1" topics={topics} />);
    expect(screen.queryByText(/Tea shop/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t('enums.businessSection.OVERVIEW')) }));
    expect(screen.getByText(/Tea shop/)).toBeVisible();
  });

  it('asks for a project when documents, examples and style need one', () => {
    render(<ContextPreviewPanel businessId="b1" topics={topics} />);
    expect(screen.getByText(t('businesses.context.needsTopic'))).toBeVisible();
  });

  it('asks the server for the chosen kind of job and project; profile jobs take no project', async () => {
    render(<ContextPreviewPanel businessId="b1" topics={topics} />);
    await userEvent.selectOptions(screen.getByLabelText(t('businesses.context.topicLabel')), 't1');
    expect(state.calls.at(-1)).toEqual({ target: 'DRAFT', topicId: 't1' });
    await userEvent.click(screen.getByRole('button', { name: t('businesses.context.target.PROFILE') }));
    expect(state.calls.at(-1)).toEqual({ target: 'PROFILE', topicId: '' });
    expect(screen.queryByLabelText(t('businesses.context.topicLabel'))).not.toBeInTheDocument();
  });
});
