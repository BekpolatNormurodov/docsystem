'use client';

// Talabnoma sahifasi tepasidagi «sonlar» — barcha FAOL firmalar bo'yicha KPI plitalari +
// firma×holat jadvali. Ma'lumot: GET /konveyer/talabnoma-board (snapshot bo'yicha, nofaol
// firma chiqmaydi). Sahifa tez ochilishi uchun mount'dan keyin yuklanadi (skeleton bilan),
// «hippo:refresh» hodisasida (yuborish/bekor) qayta yangilanadi.
import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

interface FirmRow { firmId: number; firmName: string; clients: number; toSend: number; sent: number; remaining: number; totalDebt: number }
interface Board { firms: FirmRow[]; totals: { firmCount: number; clients: number; toSend: number; sent: number; remaining: number; totalDebt: number } }

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const n = (x: number) => (x || 0).toLocaleString('ru-RU');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const shortFirm = (name: string) => name.replace(/ MIKROMOLIYA.*$/i, '').replace(/ MCHJ.*$/i, '');

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    slate: 'text-fg', indigo: 'text-indigo-600 dark:text-indigo-300',
    emerald: 'text-emerald-600 dark:text-emerald-300', amber: 'text-amber-600 dark:text-amber-300',
  };
  return (
    <div className="card p-3">
      <div className={cx('truncate text-xl font-semibold tabular-nums leading-tight', tones[tone])} title={value}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-muted">{label}</div>
    </div>
  );
}

export function TalabnomaBoard({ snapshotId }: { snapshotId?: number }) {
  const t = useT();
  const [data, setData] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (snapshotId == null) { setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/konveyer/talabnoma-board?snapshotId=${snapshotId}`, { cache: 'no-store' });
      if (!res.ok) { let e = t('Yuklab boʻlmadi'); try { e = (await res.json()).error || e; } catch {} throw new Error(e); }
      setData(await res.json());
    } catch (e) { setErr(e instanceof Error ? e.message : t('Yuklab boʻlmadi')); }
    finally { setLoading(false); }
  }, [snapshotId, t]);

  useEffect(() => { load(); }, [load]);
  // Yuborish/bekor bo'lganda (TalabnomaBulk / HippoStatusPanel) — sonlar yangilansin.
  useEffect(() => {
    const onR = () => load();
    window.addEventListener('hippo:refresh', onR);
    return () => window.removeEventListener('hippo:refresh', onR);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[62px] animate-pulse rounded-xl bg-surface-2" />)}
        </div>
        <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      </div>
    );
  }
  if (err && !data) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] px-3 py-2 text-xs">
        <span className="text-rose-500">{err}</span>
        <button onClick={load} className="rounded border border-line px-2 py-0.5 font-medium text-muted hover:border-brand-500/40">{t('Qayta')}</button>
      </div>
    );
  }
  if (!data) return null;
  const { firms, totals } = data;
  if (firms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-2/30 px-4 py-8 text-center">
        <div className="text-sm font-medium text-fg">{t('Bu snapshotда talabnoma yoʻq')}</div>
        <div className="mt-1 text-xs text-muted">{t('Faol firmalarda bu sanaga tegishli qarzli mijoz topilmadi.')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* KPI plitalari — barcha faol firmalar bo'yicha jami */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t('Firmalar')} value={n(totals.firmCount)} tone="slate" />
        <Kpi label={t('Mijozlar (kishi)')} value={n(totals.clients)} tone="slate" />
        <Kpi label={t('Talabnoma (jami)')} value={n(totals.toSend)} tone="indigo" />
        <Kpi label={t('Yuborilgan')} value={n(totals.sent)} tone="emerald" />
        <Kpi label={t('Qolgan')} value={n(totals.remaining)} tone="amber" />
        <Kpi label={t('Jami qarz (soʻm)')} value={som(totals.totalDebt)} tone="slate" />
      </div>

      {/* Firma × holat jadvali */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">{t('Firmalar boʻyicha')} ({n(firms.length)})</span>
          <span className="text-xs text-muted">{t('Yuborilgan — «iz» boʻyicha (xat.hippo)')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">{t('Firma')}</th>
                <th className="px-3 py-2 text-right">{t('Mijozlar')}</th>
                <th className="border-l border-line px-3 py-2 text-right text-indigo-600 dark:text-indigo-300">{t('Talabnoma (jami)')}</th>
                <th className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-300">{t('Yuborilgan')}</th>
                <th className="px-3 py-2 text-right text-amber-600 dark:text-amber-300">{t('Qolgan')}</th>
                <th className="w-[120px] px-3 py-2 text-left">{t('Jarayon')}</th>
                <th className="border-l border-line px-3 py-2 text-right">{t('Jami qarz')}</th>
              </tr>
            </thead>
            <tbody>
              {firms.map((f) => {
                const pct = f.toSend > 0 ? Math.round((f.sent / f.toSend) * 100) : 0;
                return (
                  <tr key={f.firmId} className="border-b border-line/60 transition-colors hover:bg-surface-2">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2.5 font-medium" title={f.firmName}>{shortFirm(f.firmName)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{f.clients > 0 ? n(f.clients) : <span className="text-muted/50">·</span>}</td>
                    <td className="border-l border-line px-3 py-2.5 text-right tabular-nums font-medium text-indigo-600 dark:text-indigo-300">{f.toSend > 0 ? n(f.toSend) : <span className="text-muted/50">·</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{f.sent > 0 ? n(f.sent) : <span className="text-muted/50">·</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{f.remaining > 0 ? n(f.remaining) : <span className="text-muted/50">·</span>}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5" title={`${pct}% ${t('yuborilgan')}`}>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted">{pct}%</span>
                      </div>
                    </td>
                    <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{f.totalDebt > 0 ? som(f.totalDebt) : <span className="text-muted/50">·</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-surface-2/50 font-semibold">
                <td className="sticky left-0 z-10 bg-surface-2/50 px-3 py-2.5">{t('JAMI')}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{n(totals.clients)}</td>
                <td className="border-l border-line px-3 py-2.5 text-right tabular-nums text-indigo-600 dark:text-indigo-300">{n(totals.toSend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{n(totals.sent)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-300">{n(totals.remaining)}</td>
                <td className="px-3 py-2.5" />
                <td className="border-l border-line px-3 py-2.5 text-right tabular-nums">{som(totals.totalDebt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
