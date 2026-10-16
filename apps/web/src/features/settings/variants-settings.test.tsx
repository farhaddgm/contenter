import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@/features/admin/api', () => ({
  useVariantSettings: () => ({ data: { maxVariants: 3 } }),
  useUpdateVariantSettings: () => ({ mutate: state.save, isPending: false }),
}));

import { VariantSettingsCard } from './components/variants-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.save = vi.fn();
});

describe('VariantSettingsCard', () => {
  it('saves the cap, and 1 switches the feature off', async () => {
    render(<VariantSettingsCard />);
    const max = screen.getByLabelText(t('variants.settings.max'));
    await userEvent.clear(max);
    await userEvent.type(max, '1');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0]![0]).toEqual({ maxVariants: 1 });
  });

  it('refuses a cap outside 1 to 3', async () => {
    render(<VariantSettingsCard />);
    const max = screen.getByLabelText(t('variants.settings.max'));
    await userEvent.clear(max);
    await userEvent.type(max, '4');
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
  });
});
