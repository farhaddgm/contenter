import { render, screen } from '@testing-library/react';
import { analyzeReadability, type ReadabilityReport } from '@contenter/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';
import { ReadabilityCard } from './components/readability-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const SIMPLE =
  'قهوه را تازه آسیاب کنید. آب را کمی صبر بدهید تا از جوش بیفتد. بعد آرام روی قهوه بریزید. ' +
  'سی ثانیه صبر کنید. حالا یک فنجان قهوهٔ خوب دارید. از آن لذت ببرید و برای ما بنویسید.';

const report = (body: string): ReadabilityReport =>
  analyzeReadability({ body, platform: 'INSTAGRAM' });

beforeEach(() => useUi.setState({ lang: 'fa' }));

describe('ReadabilityCard', () => {
  it('renders nothing without a report or without words', () => {
    expect(render(<ReadabilityCard readability={null} />).container).toBeEmptyDOMElement();
    expect(render(<ReadabilityCard readability={report('')} />).container).toBeEmptyDOMElement();
  });

  it('draws the three bars and says so when the text is simple', () => {
    render(<ReadabilityCard readability={report(SIMPLE)} />);
    expect(screen.getAllByRole('meter')).toHaveLength(3);
    expect(screen.getByText(t('contents.readability.ok'))).toBeVisible();
    expect(screen.getByText(t('contents.readability.title'))).toBeVisible();
  });

  it('words a note and lists the stiff phrases it found', () => {
    const body =
      'در جهت بهبود کیفیت محصولات ما به منظور آنکه مشتری راضی باشد تلاش کردیم. ' +
      'این محصول مورد استفاده قرار می‌گیرد و پشتیبانی آن توسط تیم ما انجام می‌شود. ' +
      'ما هر روز کار می‌کنیم تا شما بهترین قهوه را بنوشید و لذت ببرید.';
    render(<ReadabilityCard readability={report(body)} />);
    expect(screen.queryByText(t('contents.readability.ok'))).toBeNull();
    expect(screen.getByText(/عبارت رسمی یا ترجمه‌ای پیدا شد/)).toBeVisible();
    expect(screen.getByText(/«در جهت» ×۱/)).toBeVisible();
  });

  it('shows only the numbers for a text that is too short', () => {
    render(<ReadabilityCard readability={report('سلام به همه. روز خوبی داشته باشید.')} />);
    expect(screen.getByText(t('contents.readability.tooShort'))).toBeVisible();
    expect(screen.queryByText(t('contents.readability.ok'))).toBeNull();
  });
});
