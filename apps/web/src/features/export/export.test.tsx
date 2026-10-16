import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNameOf } from '@/lib/api-client';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';
import { DEFAULT_FILTERS, toExportFilter } from '@/features/contents/filters';

const state = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('./api/export', () => ({
  useExportContents: () => ({ mutate: state.mutate, isPending: false }),
}));

import { ExportMenu } from './components/export-menu';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.mutate = vi.fn();
});

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: t('export.button') }));
  return screen.getByRole('dialog');
};

describe('ExportMenu', () => {
  it('exports one content as Word by default and sends its id', async () => {
    render(<ExportMenu scope={{ ids: ['c1'] }} />);
    const dialog = await open();
    expect(within(dialog).getByText(t('export.single'))).toBeVisible();
    expect(within(dialog).getByRole('combobox')).toHaveValue('docx');
    await userEvent.click(within(dialog).getByRole('button', { name: t('export.download') }));
    expect(state.mutate.mock.calls[0]![0]).toEqual({
      ids: ['c1'],
      format: 'docx',
      onlyApproved: false,
    });
  });

  it('exports a filter as a ZIP by default, with the chosen format and the approved-only switch', async () => {
    render(<ExportMenu scope={{ filter: { topicId: 't1', statuses: 'APPROVED' } }} />);
    const dialog = await open();
    expect(within(dialog).getByRole('combobox')).toHaveValue('zip');
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'csv');
    // the format explanation lives in the field's "i" popup
    await userEvent.click(within(dialog).getByRole('button', { name: 'راهنما' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/BOM/);
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.click(within(dialog).getByRole('button', { name: t('export.download') }));
    expect(state.mutate.mock.calls[0]![0]).toEqual({
      filter: { topicId: 't1', statuses: 'APPROVED' },
      format: 'csv',
      onlyApproved: true,
    });
  });

  it('explains the formula guard and the cap', async () => {
    render(<ExportMenu scope={{ filter: {} }} />);
    const dialog = await open();
    expect(within(dialog).getByText(/= \+ - @/)).toBeVisible();
    expect(within(dialog).getByText(/۲۰۰/)).toBeVisible();
  });
});

describe('toExportFilter', () => {
  it('is the list filter without paging', () => {
    const f = toExportFilter(
      {
        ...DEFAULT_FILTERS,
        statuses: ['APPROVED', 'DRAFT'],
        q: ' قهوه ',
        page: 4,
        sort: 'title',
        order: 'asc',
      },
      { topicId: 't1' },
    );
    expect(f).toMatchObject({
      topicId: 't1',
      statuses: 'APPROVED,DRAFT',
      q: 'قهوه',
      sort: 'title',
      order: 'asc',
    });
    expect(f).not.toHaveProperty('page');
    expect(f).not.toHaveProperty('pageSize');
  });
});

describe('fileNameOf', () => {
  it('prefers the UTF-8 name, falls back to the plain one and then to a default', () => {
    expect(
      fileNameOf(
        `attachment; filename="contenter-contents.csv"; filename*=UTF-8''%D9%82%D9%87%D9%88%D9%87.csv`,
      ),
    ).toBe('قهوه.csv');
    expect(fileNameOf('attachment; filename="plain.zip"')).toBe('plain.zip');
    expect(fileNameOf(`attachment; filename*=UTF-8''%E0%A4%A`)).toBe('download');
    expect(fileNameOf(null)).toBe('download');
    expect(fileNameOf(null, 'x.bin')).toBe('x.bin');
  });
});
