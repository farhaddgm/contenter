import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SimilarityReport } from '@contenter/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';
import { SimilarityCard } from './components/similarity-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const thresholds = { warnAt: 0.55, copyAt: 0.8 };
const report = (over: Partial<SimilarityReport>): SimilarityReport => ({
  level: 'SIMILAR',
  matches: [],
  compared: 10,
  enough: true,
  thresholds,
  ...over,
});

const show = (r: SimilarityReport | null) =>
  render(
    <MemoryRouter>
      <SimilarityCard similarity={r} />
    </MemoryRouter>,
  );

beforeEach(() => useUi.setState({ lang: 'fa' }));

describe('SimilarityCard', () => {
  it('renders nothing without a report or when nothing is similar', () => {
    expect(show(null).container).toBeEmptyDOMElement();
    expect(show(report({ level: 'NONE' })).container).toBeEmptyDOMElement();
  });

  it('lists each match with its kind, score and a link to where it lives', () => {
    show(
      report({
        matches: [
          {
            kind: 'CONTENT',
            id: 'c9',
            title: 'پست قهوه',
            score: 0.62,
            topicId: 't1',
            businessId: null,
          },
          {
            kind: 'IDEA',
            id: 'i1',
            title: 'ایدهٔ قهوه',
            score: 0.58,
            topicId: 't1',
            businessId: null,
          },
          {
            kind: 'REFERENCE',
            id: 'r1',
            title: 'بروشور',
            score: 0.57,
            topicId: null,
            businessId: 'b1',
          },
        ],
      }),
    );
    expect(screen.getByText(t('contents.similarity.similar'))).toBeVisible();
    expect(screen.getByRole('link', { name: 'پست قهوه' })).toHaveAttribute(
      'href',
      '/app/contents/c9',
    );
    expect(screen.getByRole('link', { name: 'ایدهٔ قهوه' })).toHaveAttribute(
      'href',
      '/app/topics/t1/ideas',
    );
    expect(screen.getByRole('link', { name: 'بروشور' })).toHaveAttribute(
      'href',
      '/app/businesses/b1',
    );
    expect(screen.getByText('۶۲٪')).toBeVisible();
  });

  it('says "almost a copy" at the higher level and always names the limit of the check', () => {
    show(
      report({
        level: 'COPY',
        matches: [
          {
            kind: 'SAMPLE',
            id: 's1',
            title: 'نمونه',
            score: 0.93,
            topicId: 't1',
            businessId: null,
          },
        ],
      }),
    );
    expect(screen.getByText(t('contents.similarity.copy'))).toBeVisible();
    expect(screen.getByText(t('contents.similarity.limits'))).toBeVisible();
  });
});
