import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessSection, BusinessSuggestion } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'EDITOR',
  setLock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuthorization: () => ({
    user: { role: state.role },
    can: (policy: string) => (policy === 'business:lock' ? state.role === 'ADMIN' : true),
    role: state.role,
  }),
}));
const idle = { mutate: vi.fn(), isPending: false, variables: undefined };
vi.mock('./api/businesses', () => ({
  useAcceptSuggestion: () => idle,
  useDismissSuggestion: () => idle,
  useRestoreRevision: () => idle,
  useSectionRevisions: () => ({ data: [], isLoading: false }),
  useUpdateSection: () => idle,
}));
vi.mock('./api/profile-knowledge', () => ({
  useReviewSection: () => idle,
  useSetSectionLock: () => ({ mutate: state.setLock, isPending: false }),
}));

import { SectionCard } from './components/section-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const section = (over: Partial<BusinessSection> = {}): BusinessSection => ({
  id: 's1',
  businessId: 'b1',
  key: 'GUIDELINES',
  content: 'ادعای سود قطعی ممنوع.',
  source: 'ADMIN',
  reviewedAt: '2026-10-01T00:00:00Z',
  lock: 'NONE',
  lockedAt: null,
  lockNote: '',
  updatedAt: '2026-10-02T00:00:00Z',
  ...over,
});

const suggestion = { id: 'g1', content: 'متن پیشنهادی تازه', rationale: 'ساخته‌شده', createdAt: '2026-10-03T00:00:00Z' } as BusinessSuggestion;

function renderCard(s: BusinessSection, suggestions: BusinessSuggestion[] = []) {
  return render(
    <SectionCard
      businessId="b1"
      sectionKey="GUIDELINES"
      section={s}
      suggestions={suggestions}
      editable
      suggesting={false}
      onSuggest={() => undefined}
      open
      onOpenChange={() => undefined}
    />,
  );
}

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.role = 'ADMIN';
  state.setLock = vi.fn();
});

describe('SectionCard and the lock', () => {
  it('shows no lock mark on a section that is not locked, and lets a person edit', () => {
    state.role = 'EDITOR';
    renderCard(section());
    expect(screen.queryByText(t('businesses.lock.badge.AI_ONLY'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('common.edit') })).toBeVisible();
  });

  it('marks an AI lock, explains it, and still lets a person with EDIT write', () => {
    state.role = 'EDITOR';
    renderCard(section({ lock: 'AI_ONLY', lockNote: 'قانون', lockedBy: { id: 'a', name: 'مدیر' }, lockedAt: '2026-10-02T00:00:00Z' }));
    expect(screen.getByText(t('businesses.lock.badge.AI_ONLY'))).toBeVisible();
    expect(screen.getByText(t('businesses.lock.hint.AI_ONLY'))).toBeVisible();
    expect(screen.getByText(/مدیر/)).toBeVisible();
    expect(screen.getByRole('button', { name: t('common.edit') })).toBeVisible();
  });

  it('gives a non-admin no way to write into an admin-only section', () => {
    state.role = 'EDITOR';
    renderCard(section({ lock: 'ADMIN_ONLY' }), [suggestion]);
    expect(screen.getByText(t('businesses.lock.badge.ADMIN_ONLY'))).toBeVisible();
    expect(screen.queryByRole('button', { name: t('common.edit') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('businesses.suggestion.accept') })).not.toBeInTheDocument();
    // and no lock button either
    expect(screen.queryByRole('button', { name: t('businesses.lock.action') })).not.toBeInTheDocument();
    // the proposal itself is still readable
    expect(screen.getByText('متن پیشنهادی تازه')).toBeVisible();
  });

  it('lets an admin write into an admin-only section and accept a proposal', () => {
    renderCard(section({ lock: 'ADMIN_ONLY' }), [suggestion]);
    expect(screen.getByRole('button', { name: t('common.edit') })).toBeVisible();
    expect(screen.getByRole('button', { name: t('businesses.suggestion.accept') })).toBeVisible();
  });

  it('lets an admin choose a level and a note, and sends them', async () => {
    renderCard(section());
    await userEvent.click(screen.getByRole('button', { name: t('businesses.lock.action') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText(new RegExp(t('businesses.lock.level.ADMIN_ONLY'))));
    await userEvent.type(within(dialog).getByLabelText(t('businesses.lock.noteLabel')), 'قانون');
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }));
    expect(state.setLock.mock.calls[0]![0]).toEqual({ key: 'GUIDELINES', lock: 'ADMIN_ONLY', note: 'قانون' });
  });

  it('sends NONE to unlock', async () => {
    renderCard(section({ lock: 'AI_ONLY', lockNote: 'x' }));
    await userEvent.click(screen.getByRole('button', { name: t('businesses.lock.action') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText(new RegExp(t('businesses.lock.level.NONE'))));
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }));
    expect(state.setLock.mock.calls[0]![0]).toMatchObject({ key: 'GUIDELINES', lock: 'NONE' });
  });
});
