import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Tag } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  tags: [] as unknown[],
  createMutate: vi.fn(),
}));

vi.mock('./api/tags', () => ({
  useTags: () => ({ data: state.tags }),
  useCreateTag: () => ({ mutate: state.createMutate, isPending: false }),
}));

import { TagPicker } from './components/tag-picker';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const tag = (id: string, name: string): Tag => ({
  id,
  topicId: 't1',
  name,
  color: 'blue',
  createdAt: '2026-10-07T00:00:00.000Z',
});

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.tags = [tag('a', 'آموزشی'), tag('b', 'فروش')];
  state.createMutate = vi.fn();
});

describe('TagPicker', () => {
  it('shows the selected tags as chips', () => {
    render(<TagPicker topicId="t1" selected={[tag('a', 'آموزشی')]} onChange={vi.fn()} />);
    expect(screen.getByText('آموزشی')).toBeInTheDocument();
    expect(screen.queryByText('فروش')).not.toBeInTheDocument();
  });

  it('adds a tag to the selection and removes it again', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TagPicker topicId="t1" selected={[tag('a', 'آموزشی')]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(await screen.findByRole('button', { name: 'فروش' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);

    rerender(
      <TagPicker
        topicId="t1"
        selected={[tag('a', 'آموزشی'), tag('b', 'فروش')]}
        onChange={onChange}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'فروش' }));
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });

  it('offers to create a tag that does not exist yet, but not for an existing name', async () => {
    render(<TagPicker topicId="t1" selected={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: t('tags.add') }));
    const input = await screen.findByPlaceholderText(t('tags.searchOrCreate'));

    await userEvent.type(input, 'فروش');
    expect(screen.queryByText(t('tags.create', { name: 'فروش' }))).not.toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, 'جدید');
    await userEvent.click(screen.getByText(t('tags.create', { name: 'جدید' })));
    expect(state.createMutate).toHaveBeenCalledWith({ name: 'جدید' }, expect.anything());
  });

  it('is read-only when disabled', () => {
    render(<TagPicker topicId="t1" selected={[tag('a', 'آموزشی')]} onChange={vi.fn()} disabled />);
    expect(screen.getByText('آموزشی')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
