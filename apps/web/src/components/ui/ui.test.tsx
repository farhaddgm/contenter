import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { Badge } from './badge';
import { Button } from './button';
import { EmptyState } from './table';
import { Switch } from './form-controls';

describe('i18n', () => {
  it('translates and interpolates in both languages', () => {
    expect(translate('fa', 'common.save')).toBe('ذخیره');
    expect(translate('en', 'common.save')).toBe('Save');
    expect(translate('en', 'common.page', { page: 2, total: 5 })).toBe('Page 2 of 5');
  });
});

describe('UI components', () => {
  it('Button shows a spinner and is disabled while loading', () => {
    render(<Button isLoading>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeDisabled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('Badge renders its content', () => {
    render(<Badge tone="success">OK</Badge>);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('EmptyState renders title, description and action', () => {
    render(<EmptyState title="Nothing" description="Add one" action={<button>Add</button>} />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(screen.getByText('Add one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('Switch toggles', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Auto" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
