import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@/features/admin/api', () => ({
  useSimilaritySettings: () => ({ data: { warnAt: 0.55, copyAt: 0.8 } }),
  useUpdateSimilaritySettings: () => ({ mutate: state.save, isPending: false }),
}));

import { SimilaritySettingsCard } from './components/similarity-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.save = vi.fn();
});

describe('SimilaritySettingsCard', () => {
  it('shows the saved scores as percent and saves them as fractions', async () => {
    render(<SimilaritySettingsCard />);
    const warn = screen.getByLabelText(t('contents.similarity.settings.warnAt'));
    expect(warn).toHaveValue(55);
    await userEvent.clear(warn);
    await userEvent.type(warn, '40');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0]![0]).toEqual({ warnAt: 0.4, copyAt: 0.8 });
  });

  it('refuses a copy score that is not above the warning', async () => {
    render(<SimilaritySettingsCard />);
    const copy = screen.getByLabelText(t('contents.similarity.settings.copyAt'));
    await userEvent.clear(copy);
    await userEvent.type(copy, '50');
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
    expect(screen.getByText(t('contents.similarity.settings.invalid'))).toBeVisible();
  });
});
