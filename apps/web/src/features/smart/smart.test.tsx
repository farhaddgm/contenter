import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { smartBus } from '@/lib/smart-bus';
import { SmartToasts } from './components/smart-toasts';
import { useSmart } from './store';
import { stepHref, topicIdFromPath, WALKER_STEPS } from './walker-steps';

describe('walker steps', () => {
  it('has 11 ordered steps from project selection to final approval', () => {
    expect(WALKER_STEPS).toHaveLength(11);
    expect(WALKER_STEPS[0]).toBe('select_topic');
    expect(WALKER_STEPS.at(-1)).toBe('approve_content');
  });

  it('maps every step to the page where it is done', () => {
    const refs = { latestContentId: 'c1', reviewContentId: 'c2', latestProfileId: 'p1' };
    expect(stepHref('select_topic', 't1', refs)).toBe('/app/topics');
    expect(stepHref('describe_topic', 't1', refs)).toBe('/app/topics/t1');
    expect(stepHref('principles', 't1', refs)).toBe('/app/topics/t1/principles');
    expect(stepHref('analyze_samples', 't1', refs)).toBe('/app/topics/t1/samples');
    expect(stepHref('approve_profile', 't1', refs)).toBe('/app/topics/t1/profile');
    expect(stepHref('generate_content', 't1', refs)).toBe('/app/topics/t1/ideas');
    expect(stepHref('review_content', 't1', refs)).toBe('/app/contents/c2');
    expect(stepHref('approve_content', 't1', { ...refs, reviewContentId: null })).toBe('/app/contents/c1');
    expect(stepHref('approve_content', 't1', { latestContentId: null, reviewContentId: null, latestProfileId: null })).toBe(
      '/app/topics/t1/contents',
    );
  });

  it('falls back to the topic list without a project', () => {
    expect(stepHref('ideate', null)).toBe('/app/topics');
  });

  it('reads the topic id from the URL', () => {
    expect(topicIdFromPath('/app/topics/abc123/samples')).toBe('abc123');
    expect(topicIdFromPath('/app/topics')).toBeNull();
    expect(topicIdFromPath('/app/contents/x')).toBeNull();
  });
});

describe('smart store', () => {
  beforeEach(() => {
    useSmart.setState({ enabled: false, minimized: true, tab: 'walker', selectedErrorId: null, toasts: [], walkerTopicId: null, walkerStep: 'select_topic', side: 'left' });
  });

  it('opening an error turns Smart on and shows the errors tab', () => {
    useSmart.getState().openError('e1');
    const s = useSmart.getState();
    expect(s).toMatchObject({ enabled: true, minimized: false, tab: 'errors', selectedErrorId: 'e1' });
  });

  it('selecting a project moves the walker past project selection', () => {
    useSmart.getState().setWalkerTopic('t1');
    expect(useSmart.getState().walkerStep).toBe('describe_topic');
    useSmart.getState().setWalkerStep('ideate');
    useSmart.getState().setWalkerTopic('t1'); // same project → keep the step
    expect(useSmart.getState().walkerStep).toBe('ideate');
  });

  it('switches sides', () => {
    useSmart.getState().toggleSide();
    expect(useSmart.getState().side).toBe('right');
  });

  it('keeps one toast per error', () => {
    useSmart.getState().pushToast({ errorId: 'e1', message: 'a', source: 'SERVER' });
    useSmart.getState().pushToast({ errorId: 'e1', message: 'a again', source: 'SERVER' });
    expect(useSmart.getState().toasts).toHaveLength(1);
  });
});

describe('SmartToasts', () => {
  it('shows the error and opens it in the panel', async () => {
    useSmart.setState({ toasts: [], selectedErrorId: null, enabled: true });
    useSmart.getState().pushToast({ errorId: 'e9', message: 'Database is down', source: 'SERVER' });
    render(<SmartToasts />);
    expect(screen.getByText('Database is down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'جزئیات' }));
    expect(useSmart.getState().selectedErrorId).toBe('e9');
    expect(useSmart.getState().tab).toBe('errors');
  });
});

describe('smartBus', () => {
  it('isolates failing listeners', () => {
    const seen: string[] = [];
    const off1 = smartBus.on(() => {
      throw new Error('boom');
    });
    const off2 = smartBus.on((e) => seen.push(e.type));
    smartBus.emit({ type: 'error-recorded', errorId: 'x', message: 'm', source: 'CLIENT' });
    off1();
    off2();
    expect(seen).toEqual(['error-recorded']);
  });
});
