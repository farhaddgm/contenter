import { render, screen } from '@testing-library/react';
import { checkContentQuality, type QualityReport } from '@contenter/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';
import { QualityCard } from './components/quality-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const report = (body: string, platform: 'X' | 'TELEGRAM' = 'TELEGRAM'): QualityReport =>
  checkContentQuality({
    title: 'عنوان',
    body,
    hashtags: [],
    cta: '',
    platform,
    format: 'POST',
  });

beforeEach(() => useUi.setState({ lang: 'fa' }));

describe('QualityCard', () => {
  it('renders nothing without a report', () => {
    const { container } = render(<QualityCard quality={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when nothing was found, and shows the length against the limit', () => {
    render(<QualityCard quality={report('متن کوتاه و درست.')} />);
    expect(screen.getByText(t('contents.quality.ok'))).toBeVisible();
    expect(screen.getByText(/۴٬۰۹۶/)).toBeVisible();
  });

  it('words a warning from the report and keeps typography as information', () => {
    render(<QualityCard quality={report(`${'ا'.repeat(290)} می کنیم`, 'X')} />);
    expect(screen.queryByText(t('contents.quality.ok'))).toBeNull();
    expect(screen.getByText(/سقف این پلتفرم ۲۸۰ است/)).toBeVisible();
    expect(screen.getByText(/نیم‌فاصلهٔ جاافتاده/)).toBeVisible();
  });

  it('leaves brand terms to their own card', () => {
    const q = report('متن');
    q.issues.push({
      code: 'TERM_AVOID',
      severity: 'warn',
      params: { found: 'ارزان‌ترین', term: 'ارزان‌ترین', count: 1, replaceWith: '' },
    });
    render(<QualityCard quality={q} />);
    expect(screen.queryByText(/ارزان‌ترین/)).toBeNull();
    expect(screen.getByText(t('contents.quality.ok'))).toBeVisible();
  });
});
