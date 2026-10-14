import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@/features/admin/api', () => ({
  useGoldenSettings: () => ({ data: { maxExamples: 2, maxChars: 1500 } }),
  useUpdateGoldenSettings: () => ({ mutate: state.save, isPending: false }),
}));

import { GoldenSettingsCard } from './components/golden-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.save = vi.fn();
});

describe('GoldenSettingsCard', () => {
  it('saves the count and the length, and 0 switches it off', async () => {
    render(<GoldenSettingsCard />);
    const count = screen.getByLabelText(t('golden.settings.count'));
    await userEvent.clear(count);
    await userEvent.type(count, '0');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0]![0]).toEqual({ maxExamples: 0, maxChars: 1500 });
  });

  it('refuses more than the maximum', async () => {
    render(<GoldenSettingsCard />);
    const count = screen.getByLabelText(t('golden.settings.count'));
    await userEvent.clear(count);
    await userEvent.type(count, '5');
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
  });
});
