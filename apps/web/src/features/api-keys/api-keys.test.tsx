import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiKeyInfo, CreatedApiKey } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  keys: [] as unknown[],
  create: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('./api/api-keys', () => ({
  useApiKeys: () => ({ data: state.keys, isLoading: false }),
  useCreateApiKey: () => ({ mutate: state.create, isPending: false }),
  useRevokeApiKey: () => ({ mutateAsync: state.revoke, isPending: false }),
}));

import { ApiKeysCard } from './components/api-keys-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const key = (over: Partial<ApiKeyInfo> = {}): ApiKeyInfo => ({
  id: 'k1',
  name: 'n8n',
  prefix: 'ctk_0123abcd',
  scopes: ['contents:read'],
  createdAt: day(-5),
  expiresAt: day(80),
  lastUsedAt: day(-1),
  revokedAt: null,
  ...over,
});

const asRole = (role: 'ADMIN' | 'EDITOR' | 'VIEWER') =>
  useAuthStore.setState({ user: { id: 'u1', role } as never, accessToken: 'x' });

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  asRole('EDITOR');
  state.keys = [];
  state.create = vi.fn();
  state.revoke = vi.fn(async () => undefined);
});

describe('ApiKeysCard', () => {
  it('lists keys by prefix (never the key) with their status and a warning for an unused one', () => {
    state.keys = [
      key(),
      key({ id: 'k2', name: 'قدیمی', prefix: 'ctk_ffffffff', lastUsedAt: day(-45) }),
      key({ id: 'k3', name: 'لغو', prefix: 'ctk_00000000', revokedAt: day(-2) }),
    ];
    render(<ApiKeysCard />);
    expect(screen.getByText('ctk_0123abcd…')).toBeVisible();
    expect(screen.getAllByText(t('apiKeys.status.ACTIVE'))).toHaveLength(2);
    expect(screen.getByText(t('apiKeys.status.REVOKED'))).toBeVisible();
    expect(screen.getAllByText(t('apiKeys.unused', { n: '۳۰' }))).toHaveLength(1);
    // only an active key can be revoked
    expect(screen.getAllByRole('button', { name: t('apiKeys.revoke') })).toHaveLength(2);
  });

  it('creates a key with the chosen scopes and shows the whole key once', async () => {
    const made: CreatedApiKey = { ...key(), key: 'ctk_0123abcd_' + 'A'.repeat(43) };
    state.create = vi.fn((_input: unknown, opts: { onSuccess: (k: CreatedApiKey) => void }) =>
      opts.onSuccess(made),
    );
    render(<ApiKeysCard />);
    await userEvent.click(screen.getByRole('button', { name: t('apiKeys.create') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(t('apiKeys.name')), 'n8n هفتگی');
    await userEvent.click(within(dialog).getAllByRole('switch')[1]!); // contents:write
    await userEvent.click(within(dialog).getByRole('button', { name: t('apiKeys.create') }));
    expect(state.create.mock.calls[0]![0]).toEqual({
      name: 'n8n هفتگی',
      scopes: ['contents:read', 'contents:write'],
      expiresInDays: 90,
    });
    expect(screen.getByTestId('new-api-key')).toHaveTextContent(made.key);
    await userEvent.click(screen.getByRole('button', { name: t('apiKeys.savedIt') }));
    expect(screen.queryByTestId('new-api-key')).toBeNull();
  });

  it('offers a read-only account only the read scopes', async () => {
    asRole('VIEWER');
    render(<ApiKeysCard />);
    await userEvent.click(screen.getByRole('button', { name: t('apiKeys.create') }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('switch')).toHaveLength(2);
    expect(within(dialog).queryByText('contents:write')).toBeNull();
  });

  it('will not create without a name, and stops at five active keys', async () => {
    render(<ApiKeysCard />);
    await userEvent.click(screen.getByRole('button', { name: t('apiKeys.create') }));
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: t('apiKeys.create') }),
    ).toBeDisabled();
  });

  it('disables creating when five keys are already active', () => {
    state.keys = Array.from({ length: 5 }, (_, i) =>
      key({ id: `k${i}`, prefix: `ctk_0000000${i}` }),
    );
    render(<ApiKeysCard />);
    expect(screen.getByRole('button', { name: t('apiKeys.create') })).toBeDisabled();
  });

  it('revokes after a confirmation', async () => {
    state.keys = [key()];
    render(<ApiKeysCard />);
    await userEvent.click(screen.getByRole('button', { name: t('apiKeys.revoke') }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: t('apiKeys.revoke') }));
    expect(state.revoke.mock.calls[0]![0]).toBe('k1');
  });
});
