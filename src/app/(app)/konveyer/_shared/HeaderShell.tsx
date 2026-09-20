// Uch tabga umumiy sarlavha shellasi (2026-09-20 operator: «miya achiydi»).
// Har tab bir xil shakl: bir qator title + bir qator izoh · o'ng tomonda firma+updated+primary tugma
// · ostida yagona stats qatori · ostida (bo'lsa) YAGONA «Ketmoqda» strip. Chip qatorlari yo'q.
'use client';
import { useT } from '@/lib/i18n/client';

export type Tone = 'slate' | 'emerald' | 'amber' | 'teal' | 'indigo' | 'sky' | 'violet' | 'rose' | 'brand';

const DOT: Record<Tone, string> = {
  slate: 'bg-slate-400', emerald: 'bg-emerald-500', amber: 'bg-amber-500', teal: 'bg-teal-500',
  indigo: 'bg-indigo-500', sky: 'bg-sky-500', violet: 'bg-violet-500', rose: 'bg-rose-500', brand: 'bg-brand-500',
};
const VAL: Record<Tone, string> = {
  slate: 'text-fg', emerald: 'text-emerald-600 dark:text-emerald-400', amber: 'text-amber-600 dark:text-amber-400',
  teal: 'text-teal-600 dark:text-teal-400', indigo: 'text-indigo-600 dark:text-indigo-400',
  sky: 'text-sky-600 dark:text-sky-400', violet: 'text-violet-600 dark:text-violet-400',
  rose: 'text-rose-600 dark:text-rose-400', brand: 'text-brand-600 dark:text-brand-400',
};
const BTN: Record<Tone, string> = {
  slate: 'border-line hover:bg-surface-2', emerald: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/[0.18] dark:text-emerald-300',
  amber: 'border-amber-500/50 bg-amber-500/10 text-amber-700 hover:bg-amber-500/[0.18] dark:text-amber-300',
  teal: 'border-teal-500/50 bg-teal-500/10 text-teal-700 hover:bg-teal-500/[0.18] dark:text-teal-300',
  indigo: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/[0.18] dark:text-indigo-300',
  sky: 'border-sky-500/50 bg-sky-500/10 text-sky-700 hover:bg-sky-500/[0.18] dark:text-sky-300',
  violet: 'border-violet-500/50 bg-violet-500/10 text-violet-700 hover:bg-violet-500/[0.18] dark:text-violet-300',
  rose: 'border-rose-500/50 bg-rose-500/10 text-rose-700 hover:bg-rose-500/[0.18] dark:text-rose-300',
  brand: 'border-brand-500/50 bg-brand-500/10 text-brand-700 hover:bg-brand-500/[0.18] dark:text-brand-300',
};
const NOTICE: Record<'ok'|'warn'|'err', string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-800 dark:text-emerald-200',
  warn: 'border-amber-500/40 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200',
  err: 'border-rose-500/40 bg-rose-500/[0.06] text-rose-800 dark:text-rose-200',
};

export interface HeaderStat { key: string; label: string; value: number | string; tone: Tone; hint?: string }
export interface HeaderAction { label: string; onClick: () => void; tone?: Tone; disabled?: boolean; title?: string }
export interface HeaderRunning { firmName: string; kindLabel: string; progress: number; total: number; onCancel?: () => void }
export interface HeaderNotice { tone: 'ok'|'warn'|'err'; text: string; action?: { label: string; onClick: () => void } }

export function HeaderShell(props: {
  title: string;
  subtitle?: string;
  firmSlot?: React.ReactNode;
  updatedAt?: string | null;
  primary?: HeaderAction | null;
  secondary?: HeaderAction[];
  stats: HeaderStat[];
  running?: HeaderRunning | null;
  notice?: HeaderNotice | null;
}) {
  const t = useT();
  const n = (x: number | string) => typeof x === 'number' ? x.toLocaleString('ru-RU') : x;
  return (
    <section className="rounded-xl border border-line bg-surface">
      {/* 1-QATOR: title + o'ng tomonda firma dropdown, yangilanish vaqti, primary tugma */}
      <div className="flex flex-wrap items-start gap-3 border-b border-line p-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="text-[15px] font-semibold leading-snug">{t(props.title)}</h2>
          {props.subtitle && <p className="mt-0.5 text-[12px] leading-snug text-muted">{t(props.subtitle)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.firmSlot}
          {props.updatedAt && <span className="text-[11px] tabular-nums text-muted" title={t('Sonlar yangilangan vaqti')}>{t('Yangilangan')}: {props.updatedAt}</span>}
          {props.secondary?.map((a, i) => (
            <button key={i} type="button" onClick={a.onClick} disabled={a.disabled} title={a.title}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 ${BTN[a.tone ?? 'slate']}`}>
              {t(a.label)}
            </button>
          ))}
          {props.primary && (
            <button type="button" onClick={props.primary.onClick} disabled={props.primary.disabled} title={props.primary.title}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50 ${BTN[props.primary.tone ?? 'brand']}`}>
              {t(props.primary.label)}
            </button>
          )}
        </div>
      </div>

      {/* 2-QATOR: STATS (3-5 chip, bir xil shakl) — chip emas, dot+label+value */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2.5">
        {props.stats.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5" title={s.hint ? t(s.hint) : undefined}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.tone]}`} aria-hidden />
            <span className="text-[11px] uppercase tracking-wide text-muted">{t(s.label)}</span>
            <span className={`text-[15px] font-semibold tabular-nums ${VAL[s.tone]}`}>{n(s.value)}</span>
          </div>
        ))}
      </div>

      {/* 3-QATOR (bo'lsa): YAGONA «Ketmoqda» strip — butun sahifada faqat bir joyda */}
      {props.running && (
        <div className="flex items-center gap-2 border-t border-line bg-sky-500/[0.06] px-3 py-2 text-[12px]" role="status" aria-live="polite">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sky-800 dark:text-sky-200">
            <span className="font-semibold">{t('Ketmoqda')}:</span> {props.running.firmName} · {t(props.running.kindLabel)} · <span className="tabular-nums">{n(props.running.progress)}/{n(props.running.total)}</span>
          </span>
          {props.running.total > 0 && (
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-sky-500/20" aria-hidden>
              <span className="block h-full min-w-[3px] rounded-full bg-sky-500" style={{ width: `${Math.max(2, Math.min(100, Math.round((props.running.progress / props.running.total) * 100)))}%` }} />
            </span>
          )}
          {props.running.onCancel && (
            <button type="button" onClick={props.running.onCancel}
              className="inline-flex shrink-0 items-center rounded-md border border-rose-500/40 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-300">
              {t('To‘xtatish')}
            </button>
          )}
        </div>
      )}

      {/* 4-QATOR (bo'lsa): NOTICE — ogohlantirish/xato/muvaffaqiyat */}
      {props.notice && (
        <div className={`flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[12px] ${NOTICE[props.notice.tone]}`} role="alert" aria-live="polite">
          <span className="min-w-0 flex-1">{t(props.notice.text)}</span>
          {props.notice.action && (
            <button type="button" onClick={props.notice.action.onClick} className="inline-flex shrink-0 items-center rounded-md border border-current/40 px-2 py-0.5 text-[11px] font-medium hover:bg-current/10">
              {t(props.notice.action.label)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
