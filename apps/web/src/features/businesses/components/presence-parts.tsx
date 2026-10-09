import { useRef } from 'react';
import { FileUp } from 'lucide-react';
import {
  INSTAGRAM_MAX_POSTS,
  parseInstagramExport,
  splitCaptions,
  type InstagramAnalysis,
  type InstagramManualInput,
  type InstagramManualPost,
  type InstagramMediaType,
  type ReferenceAnalysis,
  type WebsiteAnalysis,
} from '@contenter/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { useT, type TFn } from '@/i18n';
import { notify } from '@/stores/notifications';
import { formatDate, formatNumber } from '@/utils/format';

/** What the admin typed for an Instagram account that is not read through the API. */
export interface ManualInstagramState {
  biography: string;
  followers: string;
  captions: string;
  /** Posts read from Instagram's own data export file (replace the typed captions). */
  exported: InstagramManualPost[];
}

export const EMPTY_MANUAL: ManualInstagramState = {
  biography: '',
  followers: '',
  captions: '',
  exported: [],
};

export function manualPosts(m: ManualInstagramState): InstagramManualPost[] {
  return m.exported.length
    ? m.exported
    : splitCaptions(m.captions)
        .slice(0, INSTAGRAM_MAX_POSTS)
        .map((caption) => ({ caption }));
}

/** The request body for the typed data, or undefined when there is nothing to send. */
export function toManualInput(handle: string, m: ManualInstagramState): InstagramManualInput | undefined {
  const posts = manualPosts(m);
  if (!m.biography.trim() && !posts.length) return undefined;
  const followers = Number(m.followers.replace(/[^\d]/g, ''));
  return {
    handle: handle.trim(),
    biography: m.biography.trim(),
    followers: m.followers.trim() && Number.isFinite(followers) ? followers : null,
    posts,
  };
}

/** Bio, followers and captions (typed, or loaded from Instagram's JSON export). */
export function InstagramManualFields({
  value,
  onChange,
}: {
  value: ManualInstagramState;
  onChange: (v: ManualInstagramState) => void;
}) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <p className="text-xs leading-6 text-muted-foreground">{t('businesses.presence.manualHint')}</p>
      <Field label={t('businesses.presence.bio')} optional={t('common.optional')}>
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            dir="auto"
            maxLength={2000}
            value={value.biography}
            onChange={(e) => onChange({ ...value, biography: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('businesses.presence.followers')} optional={t('common.optional')}>
        {(id) => (
          <Input
            id={id}
            dir="ltr"
            inputMode="numeric"
            value={value.followers}
            maxLength={12}
            onChange={(e) => onChange({ ...value, followers: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('businesses.presence.captions')} hint={t('businesses.presence.captionsHint')}>
        {(id) => (
          <Textarea
            id={id}
            rows={6}
            dir="auto"
            value={value.captions}
            disabled={value.exported.length > 0}
            onChange={(e) => onChange({ ...value, captions: e.target.value })}
          />
        )}
      </Field>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (!picked) return;
          void picked.text().then((raw) => {
            try {
              const exported = parseInstagramExport(raw);
              onChange({ ...value, exported });
              notify.success(t('businesses.presence.exportLoaded', { count: exported.length }));
            } catch (err) {
              notify.error(t('businesses.presence.exportFailed'), (err as Error).message);
            }
          });
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        icon={<FileUp />}
        onClick={() => file.current?.click()}
      >
        {t('businesses.presence.uploadExport')}
      </Button>
      {value.exported.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('businesses.presence.exportLoaded', { count: value.exported.length })}{' '}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onChange({ ...value, exported: [] })}
          >
            {t('common.delete')}
          </button>
        </p>
      )}
    </div>
  );
}

/** One-line summary of what code computed (shown in the reference list). */
export function analysisSummary(
  a: ReferenceAnalysis,
  t: TFn,
): string {
  if (a.type === 'WEBSITE') {
    return t('businesses.analysis.summaryWebsite', { pages: formatNumber(a.pages.length) });
  }
  return t('businesses.analysis.summaryInstagram', {
    followers: a.profile.followers === null ? '؟' : formatNumber(a.profile.followers),
    posts: formatNumber(a.stats.postsAnalyzed),
    perWeek: a.stats.postsPerWeek === null ? '؟' : formatNumber(a.stats.postsPerWeek, 1),
  });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2" title={hint}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium" dir="auto">
        {value}
      </p>
    </div>
  );
}

const pct = (share: number) => `${formatNumber(Math.round(share * 100))}٪`;

function InstagramReport({ a }: { a: InstagramAnalysis }) {
  const t = useT();
  const s = a.stats;
  const mix = Object.entries(s.formatMix)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${t(`businesses.analysis.format.${k as InstagramMediaType}`)} ${formatNumber(v)}`)
    .join(' · ');
  const known = (n: number | null) => (n === null ? '؟' : formatNumber(n));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t('businesses.analysis.source')}: {t(`businesses.analysis.${a.provider}`)}
        {a.profile.username && ` · @${a.profile.username}`}
        {s.firstPostAt && s.lastPostAt && ` · ${formatDate(s.firstPostAt)} → ${formatDate(s.lastPostAt)}`}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('businesses.analysis.followers')} value={known(a.profile.followers)} />
        <Stat label={t('businesses.analysis.mediaCount')} value={known(a.profile.mediaCount)} />
        <Stat label={t('businesses.analysis.postsAnalyzed')} value={formatNumber(s.postsAnalyzed)} />
        <Stat label={t('businesses.analysis.perWeek')} value={known(s.postsPerWeek)} />
        {s.engagement ? (
          <>
            <Stat label={t('businesses.analysis.avgLikes')} value={formatNumber(s.engagement.avgLikes, 1)} />
            <Stat
              label={t('businesses.analysis.avgComments')}
              value={formatNumber(s.engagement.avgComments, 1)}
            />
            <Stat
              label={t('businesses.analysis.rate')}
              hint={t('businesses.analysis.rateHint')}
              value={s.engagement.ratePct === null ? '؟' : `${formatNumber(s.engagement.ratePct, 2)}٪`}
            />
          </>
        ) : null}
        <Stat
          label={t('businesses.analysis.captionLength')}
          value={formatNumber(s.avgCaptionChars)}
        />
        <Stat label={t('businesses.analysis.emojis')} value={formatNumber(s.avgEmojisPerPost, 1)} />
        <Stat label={t('businesses.analysis.hashtagsPer')} value={formatNumber(s.avgHashtagsPerPost, 1)} />
        <Stat label={t('businesses.analysis.cta')} value={pct(s.ctaShare)} />
        <Stat label={t('businesses.analysis.questions')} value={pct(s.questionShare)} />
        <Stat label={t('businesses.analysis.persianShare')} value={pct(s.scriptShare.persian)} />
      </div>
      {!s.engagement && (
        <p className="text-xs text-muted-foreground">{t('businesses.analysis.noCounts')}</p>
      )}
      {mix && (
        <p className="text-xs">
          <span className="font-medium">{t('businesses.analysis.formats')}: </span>
          {mix}
        </p>
      )}
      {s.topHashtags.length > 0 && (
        <p className="text-xs leading-6" dir="auto">
          <span className="font-medium">{t('businesses.analysis.hashtags')}: </span>
          {s.topHashtags.map((h) => `${h.tag} (${formatNumber(h.count)})`).join('  ')}
        </p>
      )}
      {s.topPosts.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">{t('businesses.analysis.topPosts')}</p>
          <ul className="space-y-1">
            {s.topPosts.map((p, i) => (
              <li key={`${p.permalink}-${i}`} className="flex gap-2" dir="auto">
                <span className="shrink-0 text-muted-foreground">
                  ♥ {known(p.likes)} · 💬 {known(p.comments)}
                </span>
                <span className="truncate">{p.hook || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WebsiteReport({ a }: { a: WebsiteAnalysis }) {
  const t = useT();
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground" dir="auto">
        {a.name} · {a.origin}
        {a.language && ` · ${a.language}`}
        {a.sitemap && ` · ${t('businesses.analysis.sitemap')}`}
      </p>
      <div>
        <p className="mb-1 font-medium">
          {t('businesses.analysis.pages')} ({formatNumber(a.pages.length)})
        </p>
        <ul className="space-y-0.5">
          {a.pages.map((p) => (
            <li key={p.url} className="flex gap-2" dir="ltr">
              <span className="shrink-0 text-muted-foreground">{formatNumber(p.chars)}</span>
              <span className="truncate">{p.title || p.url}</span>
            </li>
          ))}
        </ul>
      </div>
      {a.skipped > 0 && (
        <p className="text-muted-foreground">
          {t('businesses.analysis.skipped', { count: formatNumber(a.skipped) })}
        </p>
      )}
      {a.robotsLimited && <p className="text-muted-foreground">{t('businesses.analysis.robots')}</p>}
      {(a.emails.length > 0 || a.phones.length > 0) && (
        <p dir="auto">
          <span className="font-medium">{t('businesses.analysis.contacts')}: </span>
          {[...a.emails, ...a.phones].join(' · ')}
        </p>
      )}
      {a.socialLinks.length > 0 && (
        <p dir="ltr" className="leading-6">
          <span className="font-medium">{t('businesses.analysis.social')}: </span>
          {a.socialLinks.map((s) => s.network).join(' · ')}
        </p>
      )}
    </div>
  );
}

/** What code computed about an Instagram account or a website (no AI involved). */
export function AnalysisReport({ analysis }: { analysis: ReferenceAnalysis }) {
  const t = useT();
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">{t('businesses.analysis.title')}</h3>
      {analysis.type === 'INSTAGRAM' ? (
        <InstagramReport a={analysis} />
      ) : (
        <WebsiteReport a={analysis} />
      )}
    </section>
  );
}
