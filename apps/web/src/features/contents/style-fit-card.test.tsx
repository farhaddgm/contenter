import { render, screen } from '@testing-library/react';
import { assessStyleFit, styleStats, targetsFromTexts, type StyleTargets } from '@contenter/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';
import { StyleFitCard } from './components/style-fit-card';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('fa', key, vars);

const SAMPLES = [
  'قهوهٔ صبحگاهی را با ۲ قاشق شکر می‌نوشید؟ ☕\n\nما هر روز تازه‌ترین دانه‌ها را برای شما آسیاب می‌کنیم و در بسته‌های کوچک می‌فرستیم. همین حالا سفارش بدهید.\n\n#قهوه #صبحانه',
  'آیا می‌دانستید که آسیاب تازه طعم قهوه را کاملاً عوض می‌کند؟ ☕😍\n\nدانه‌های ما هر هفته برشته می‌شوند و در همان روز بسته‌بندی می‌شوند. برای سفارش دایرکت بدهید.\n\n#قهوه #آسیاب',
  'چای یا قهوه؟ هرکدام را که دوست دارید، تازه‌اش را بنوشید! ☕\n\nما هر دو را با دقت انتخاب می‌کنیم و سر وقت به دست شما می‌رسانیم. همین حالا ثبت‌نام کنید.\n\n#قهوه #چای',
];
const targets = targetsFromTexts(SAMPLES) as StyleTargets;

beforeEach(() => useUi.setState({ lang: 'fa' }));

describe('StyleFitCard', () => {
  it('renders nothing without data', () => {
    expect(render(<StyleFitCard styleFit={null} />).container).toBeEmptyDOMElement();
    expect(render(<StyleFitCard styleFit={undefined} />).container).toBeEmptyDOMElement();
  });

  it('says there is not enough data instead of a number', () => {
    render(<StyleFitCard styleFit={{ tooFew: true, basedOn: 2, needed: 3 }} />);
    expect(screen.getByText(t('styleFit.tooFew', { have: '۲', need: '۳' }))).toBeVisible();
  });

  it('lists each measure with its range and where the draft lies, and never claims it reads like the brand', () => {
    const draft = styleStats('این یک متن بسیار طولانی است. '.repeat(40));
    const report = assessStyleFit(draft, targets);
    render(<StyleFitCard styleFit={report} />);
    expect(screen.getByText(/از ۸ شاخص در بازهٔ نمونه‌ها/)).toBeVisible();
    expect(screen.getByText(t('styleFit.metrics.chars'))).toBeVisible();
    expect(screen.getAllByText(t('styleFit.status.above')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('styleFit.status.below')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('styleFit.source.SAMPLES', { n: '۳' }))).toBeVisible();
    expect(screen.getByText(/نه اینکه متن «با سبک می‌خواند»/)).toBeVisible();
  });

  it('shows a flag against what the samples usually do', () => {
    const report = assessStyleFit(styleStats('یک متن کوتاه و ساده بدون پرسش'), targets);
    render(<StyleFitCard styleFit={report} />);
    expect(screen.getAllByText(new RegExp(t('styleFit.samplesAll'))).length).toBe(2);
  });
});
