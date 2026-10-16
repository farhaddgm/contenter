import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { Badge } from './badge';
import { Button } from './button';
import { EmptyState } from './table';
import { PageHeader } from './misc';
import { Field, Input } from './form-controls';
import { OwnerBadge } from './owner-badge';
import { useSmart } from '@/features/smart/store';
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

  it('Badge can show a status dot', () => {
    const { container } = render(
      <Badge tone="success" dot>
        OK
      </Badge>,
    );
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument();
  });

  it('PageHeader renders the primary action last in reading order (row-reverse)', () => {
    render(<PageHeader title="T" actions={<button>Primary</button>} />);
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Primary' }).parentElement).toHaveClass(
      'flex-row-reverse',
    );
  });

  it('the Smart panel starts as a small pill, not an open window', () => {
    expect(useSmart.getInitialState().minimized).toBe(true);
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

  it('Field shows its hint in an "i" popup, not as text under the field', async () => {
    render(
      <Field label="Name" hint="Explains the name">
        {(id) => <Input id={id} />}
      </Field>,
    );
    expect(screen.queryByText('Explains the name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'راهنما' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Explains the name');
  });

  it('OwnerBadge labels owner-only sections', () => {
    render(<OwnerBadge />);
    expect(screen.getByText('مالک')).toBeInTheDocument();
  });
});
