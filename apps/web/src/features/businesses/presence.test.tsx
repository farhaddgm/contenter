import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { InstagramAnalysis, WebsiteAnalysis } from '@contenter/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const state = vi.hoisted(() => ({
  create: vi.fn(),
  graph: false,
}));

vi.mock('./api/businesses', () => ({
  useCreateFromPresence: () => ({ mutate: state.create, isPending: false }),
  useInstagramStatus: () => ({ data: { graphConfigured: state.graph } }),
}));

import { FromPresenceDialog } from './components/from-presence-dialog';
import {
  AnalysisReport,
  analysisSummary,
  EMPTY_MANUAL,
  manualPosts,
  toManualInput,
} from './components/presence-parts';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

beforeEach(() => {
  useUi.setState({ lang: 'fa' });
  state.create = vi.fn();
  state.graph = false;
});

const open = () =>
  render(
    <MemoryRouter>
      <FromPresenceDialog onOpenChange={vi.fn()} />
    </MemoryRouter>,
  );
const submit = () => screen.getByRole('button', { name: t('businesses.presence.submit') });
const instagramField = () => screen.getByPlaceholderText('@brand');
const websiteField = () => screen.getByPlaceholderText('https://brand.ir');

describe('FromPresenceDialog', () => {
  it('needs an account or a website before it can be sent', async () => {
    open();
    expect(submit()).toBeDisabled();
    await userEvent.type(websiteField(), 'https://brand.ir');
    expect(submit()).toBeEnabled();
  });

  it('rejects a post link and a website without http', async () => {
    open();
    await userEvent.type(instagramField(), 'https://www.instagram.com/p/Cabc123/');
    expect(screen.getByText(t('businesses.presence.invalidInstagram'))).toBeVisible();
    expect(submit()).toBeDisabled();
    await userEvent.clear(instagramField());
    await userEvent.type(websiteField(), 'brand.ir');
    expect(screen.getByText(t('businesses.presence.invalidWebsite'))).toBeVisible();
    expect(submit()).toBeDisabled();
  });

  it('without the Instagram API an account needs its bio or captions typed in', async () => {
    open();
    expect(screen.getByText(t('businesses.presence.graphOff'))).toBeVisible();
    await userEvent.type(instagramField(), '@cafe_noor');
    expect(submit()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(t('businesses.presence.bio'), { exact: false }), 'قهوهٔ تخصصی');
    expect(submit()).toBeEnabled();
    await userEvent.click(submit());
    expect(state.create).toHaveBeenCalledTimes(1);
    const body = state.create.mock.calls[0]![0];
    expect(body.instagram).toBe('');
    expect(body.instagramManual).toMatchObject({ handle: 'cafe_noor', biography: 'قهوهٔ تخصصی' });
  });

  it('with the Instagram API an account alone is enough and is sent as a username', async () => {
    state.graph = true;
    open();
    expect(screen.getByText(t('businesses.presence.graphOn'))).toBeVisible();
    await userEvent.type(instagramField(), 'https://instagram.com/Cafe_Noor/');
    await userEvent.type(websiteField(), 'https://cafenoor.ir');
    await userEvent.click(submit());
    expect(state.create.mock.calls[0]![0]).toMatchObject({
      instagram: 'cafe_noor',
      instagramManual: undefined,
      website: 'https://cafenoor.ir',
      scope: 'REFERENCES',
    });
  });
});

describe('typed Instagram data', () => {
  it('splits captions on --- lines and prefers an export file', () => {
    const typed = { ...EMPTY_MANUAL, captions: 'one\n---\ntwo' };
    expect(manualPosts(typed)).toEqual([{ caption: 'one' }, { caption: 'two' }]);
    const exported = { ...typed, exported: [{ caption: 'from file' }] };
    expect(manualPosts(exported)).toEqual([{ caption: 'from file' }]);
  });

  it('builds nothing from empty fields and reads followers as a number', () => {
    expect(toManualInput('x', EMPTY_MANUAL)).toBeUndefined();
    const input = toManualInput('x', { ...EMPTY_MANUAL, biography: 'bio', followers: '۱٬۲۰۰'.replace(/\D/g, '') || '1200' });
    expect(input).toMatchObject({ handle: 'x', biography: 'bio', followers: 1200 });
    expect(toManualInput('', { ...EMPTY_MANUAL, biography: 'bio' })?.followers).toBeNull();
  });
});

describe('analysis report', () => {
  const instagram: InstagramAnalysis = {
    type: 'INSTAGRAM',
    provider: 'GRAPH',
    profile: {
      username: 'cafe_noor',
      name: 'کافه نور',
      biography: '',
      website: '',
      followers: 12_400,
      following: 10,
      mediaCount: 342,
    },
    stats: {
      postsAnalyzed: 30,
      firstPostAt: '2026-08-03T00:00:00Z',
      lastPostAt: '2026-09-30T00:00:00Z',
      postsPerWeek: 3.5,
      formatMix: { IMAGE: 20, REEL: 10 },
      avgCaptionChars: 65,
      emptyCaptions: 0,
      avgEmojisPerPost: 0.6,
      avgHashtagsPerPost: 1.4,
      topHashtags: [{ tag: '#قهوه', count: 18 }],
      topMentions: [],
      scriptShare: { persian: 0.82, latin: 0.18 },
      ctaShare: 0.4,
      questionShare: 0.2,
      engagement: { postsWithCounts: 30, avgLikes: 196.5, avgComments: 6.7, ratePct: 1.64 },
      topPosts: [
        {
          permalink: 'https://www.instagram.com/p/a/',
          takenAt: null,
          mediaType: 'REEL',
          likes: 299,
          comments: 3,
          hook: 'ورک‌شاپ دم‌آوری',
        },
      ],
    },
  };

  it('summarizes an account in one line, keeping decimals', () => {
    const line = analysisSummary(instagram, t);
    expect(line).toContain('۳٫۵');
    expect(line).toContain('۱۲٬۴۰۰');
  });

  it('shows the statistics, hashtags and top posts of an account', () => {
    render(<AnalysisReport analysis={instagram} />);
    expect(screen.getByText(t('businesses.analysis.title'))).toBeVisible();
    expect(screen.getByText('۱٫۶۴٪')).toBeVisible();
    expect(screen.getByText(/#قهوه/)).toBeVisible();
    expect(screen.getByText('ورک‌شاپ دم‌آوری')).toBeVisible();
  });

  it('says so when a source has no like or comment counts', () => {
    render(<AnalysisReport analysis={{ ...instagram, stats: { ...instagram.stats, engagement: null } }} />);
    expect(screen.getByText(t('businesses.analysis.noCounts'))).toBeVisible();
  });

  it('lists the pages read from a website and what was left out', () => {
    const site: WebsiteAnalysis = {
      type: 'WEBSITE',
      origin: 'https://brand.ir',
      name: 'برند',
      description: '',
      language: 'fa',
      pages: [
        { url: 'https://brand.ir/', title: 'خانه', chars: 700 },
        { url: 'https://brand.ir/about', title: 'درباره ما', chars: 900 },
      ],
      skipped: 3,
      robotsLimited: true,
      sitemap: true,
      schemaTypes: [],
      emails: ['info@brand.ir'],
      phones: [],
      socialLinks: [{ network: 'telegram', url: 'https://t.me/brand' }],
    };
    render(<AnalysisReport analysis={site} />);
    expect(screen.getByText('درباره ما')).toBeVisible();
    expect(screen.getByText(t('businesses.analysis.robots'))).toBeVisible();
    expect(screen.getByText(t('businesses.analysis.skipped', { count: '۳' }))).toBeVisible();
    expect(analysisSummary(site, t)).toBe(t('businesses.analysis.summaryWebsite', { pages: '۲' }));
  });
});
