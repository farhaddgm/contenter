import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  data: { extraPhrases: ['راهکار نوین'], maxAvgSentenceWords: null as number | null },
  save: vi.fn(),
}));

vi.mock('@/features/admin/api', () => ({
  useReadabilitySettings: () => ({ data: state.data }),
  useUpdateReadabilitySettings: () => ({ mutate: state.save, isPending: false }),
}));

import { ReadabilitySettingsCard } from './components/readability-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.save = vi.fn();
});

describe('ReadabilitySettingsCard', () => {
  it('saves one phrase per line and the limit', async () => {
    render(<ReadabilitySettingsCard />);
    const phrases = screen.getByLabelText(t('contents.readability.settings.phrases'));
    expect(phrases).toHaveValue('راهکار نوین');
    await userEvent.type(phrases, '{enter}  به نحو احسن ');
    await userEvent.type(screen.getByLabelText(t('contents.readability.settings.limit')), '16');
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }));
    expect(state.save.mock.calls[0]![0]).toEqual({
      extraPhrases: ['راهکار نوین', 'به نحو احسن'],
      maxAvgSentenceWords: 16,
    });
  });

  it('refuses a limit out of range', async () => {
    render(<ReadabilitySettingsCard />);
    await userEvent.type(screen.getByLabelText(t('contents.readability.settings.limit')), '2');
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
    expect(screen.getByText(t('contents.readability.settings.invalid'))).toBeVisible();
  });
});
