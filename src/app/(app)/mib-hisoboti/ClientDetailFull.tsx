'use client';

// Bitta mijozning TO'LIQ detal ko'rinishi — alohida sahifa (/mib-hisoboti/mijoz/[id]) va konveyer
// modalining ichki ko'rinishi ikkalasi ham shuni ishlatadi. O'zi /api/mib/client/[cid] dan o'qiydi va
// tekshiruv ketayotganda (PENDING/RUNNING) jonli yangilanadi — shuning uchun bitta PINFL qo'shib,
// uning sahifasida natija to'lishini kuzatish mumkin.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Ico, Spinner } from '@/ui';
import { useT } from '@/lib/i18n/client';
import { money, val, type ClientRow, type CaseRow } from './MibClientDetail';
import { MibLogPanel } from './MibLogPanel';
import { RecheckModal } from './RecheckModal';
import { regionOf, parseMoney, clean, shortFirm } from '@/lib/mib/breakdown';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const STATUS_LABEL: Record<string, string> = { PENDING: 'Navbatda', RUNNING: 'Tekshirilmoqda', DONE: 'Topildi', CLEAN: 'Toza', FAILED: 'Xato' };

export function ClientDetailFull({ reportId, clientId, backHref, onBack }: { reportId: number; clientId: number; backHref?: string; onBack?: () => void }) {
  const t = useT();
  const [client, setClient] = useState<ClientRow | null>(null);
  const [running, setRunning] = useState(false); // reportда jonli run bormi
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  // Arxiv toggle: default OFF — faqat faol (so'nggi tekshiruv) ishlari. ON — arxivlangan (eski qayta
  // tekshirish nusxalari) ham. Server `archivedCount` ni beradi — tugmada ko'rsatamiz.
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  // «Qayta tekshirish» modali
  const [recheckOpen, setRecheckOpen] = useState(false);

  const load = useCallback(async () => {
    const qs = showArchived ? '?archived=1' : '';
    const r = await fetch(`/api/mib/client/${clientId}${qs}`, { cache: 'no-store' });
    if (r.status === 404) { setMissing(true); setLoading(false); return; }
    const j = await r.json().catch(() => null);
    setClient(j?.client ?? null); setRunning(!!j?.running);
    if (typeof j?.archivedCount === 'number') setArchivedCount(j.archivedCount);
    setLoading(false);
  }, [clientId, showArchived]);
  useEffect(() => { void load(); }, [load]);

  // Jonli yangilanish: RUNNING bo'lsa, yoki PENDING bo'lib run ham ketayotgan bo'lsa. PENDING lekin run
  // yo'q bo'lsa (uzilgan) — cheksiz spinner bo'lmasin, «Qayta tekshirish» ko'rsatamiz.
  const active = !!client && (client.status === 'RUNNING' || (client.status === 'PENDING' && running));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 3500);
    return () => clearInterval(t);
  }, [active, load]);

  const openRecheck = () => setRecheckOpen(true);
  const doRecheck = async () => {
    if (!client) return;
    setRechecking(true);
    await fetch(`/api/mib/${reportId}/add-pinfl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinfl: client.pinfl, force: true }) }).catch(() => {});
    setRecheckOpen(false);
    await load();
    setRechecking(false);
  };

  const back = backHref
    ? <Link href={backHref} className="btn-ghost"><Ico.chevronLeft size={16} /> {t('Roʻyxatga qaytish')}</Link>
    : <button onClick={onBack} className="btn-ghost"><Ico.chevronLeft size={16} /> {t('Roʻyxatga qaytish')}</button>;

  if (loading) return <div className="space-y-4">{back}<div className="grid place-items-center py-20"><Spinner /></div></div>;
  if (missing || !client) return <div className="space-y-4">{back}<div className="card p-10 text-center text-sm text-muted">{t('Mijoz topilmadi.')}</div></div>;

  const fullName = client.cases.map((k) => k.personFullName).find((nm) => nm && !nm.includes('***') && nm !== 'Nomaʼlum') || clean(client.fio2) || clean(client.fio) || client.pinfl;
  const hasDetail = client.cases.some((k) => k.detailFetchedAt);
  const region = regionOf(client);
  const banks = [...new Set(client.cases.map((k) => clean(k.bankName)).filter(Boolean))];
  const depts = [...new Set(client.cases.map((k) => clean(k.executorDept)).filter(Boolean))];
  const remaining = client.cases.reduce((s, k) => s + parseMoney(k.remainingDebt), 0);
  const ours = client.cases.filter((k) => k.isTargetFirm).length;

  return (
    <div className="space-y-4">
      <RecheckModal
        open={recheckOpen}
        info={client ? { pinfl: client.pinfl, lastCheckedAt: client.checkedAt, cases: showArchived ? undefined : client.cases.length } : null}
        onClose={() => setRecheckOpen(false)}
        onConfirm={doRecheck}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <div className="flex items-center gap-2">
          {(archivedCount > 0 || showArchived) && (
            <button
              className={cx('btn-ghost text-xs', showArchived && 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}
              onClick={() => setShowArchived((v) => !v)}
              title={t('Arxivlangan (eski qayta tekshirish) ishlarini koʻrsatish/yashirish')}
            >
              <Ico.archive size={14} /> {showArchived ? t('Arxivни yashirish') : `${t('Arxiv')} · ${archivedCount}`}
            </button>
          )}
          <button className="btn-ghost text-xs" disabled={rechecking || active} onClick={openRecheck}>
            {rechecking ? <Spinner size={14} /> : <Ico.refresh size={14} />} {t('Qayta tekshirish')}
          </button>
          <a className="btn-ghost text-xs" href={`/api/mib/${reportId}/excel?client=${client.id}`}><Ico.download size={14} /> {t('Shu mijoz — Excel')}</a>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{fullName}</h3>
            <div className="mt-0.5 text-sm text-muted tabular-nums">{t('PINFL:')} {client.pinfl}{client.firm ? ` · ${client.firm}` : ''}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {active && <span className="badge border-amber-500/30 text-amber-600 dark:text-amber-300"><Spinner size={11} className="mr-1" /> {t(STATUS_LABEL[client.status])}</span>}
            {client.cases.length > 0 && <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{client.cases.length} {t('ijro ishi')}</span>}
            {ours > 0 && <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300">{ours} {t('bizniki')}</span>}
          </div>
        </div>
        {client.error && <div className="mt-2 text-xs text-rose-500">{client.error}</div>}
        {!hasDetail && client.cases.length > 0 && <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">{t('Chuqur detal (SMS) hali olinmagan — faqat ijro ishlari roʻyxati.')}</div>}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Field l={t('Region')} v={region ?? '—'} />
          <Field l={t('Hudud (MIB boʻlimi)')} v={depts.join(', ') || '—'} />
          <Field l={t('Bank')} v={banks.join(', ') || '—'} />
          <Field l={t('Umumiy qarz (mib)')} v={money(client.totalDebt)} strong />
          <Field l={t('Qoldiq qarz — jami')} v={remaining > 0 ? som(remaining) : '—'} strong />
        </dl>
      </div>

      {active && client.cases.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/8 via-surface to-surface p-6 text-center dark:from-emerald-400/10">
          <div className="flex flex-col items-center gap-3">
            <span className="relative flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
            </span>
            <div className="text-base font-semibold text-emerald-700 dark:text-emerald-300">{t('mib.uz’dan tekshirilmoqda — jonli')}</div>
            <div className="text-xs text-muted">{t('Captcha yechilib, SMS OTP kutilmoqda. Natija shu yerda avtomatik paydo boʻladi (har 3.5 s’da yangilanadi).')}</div>
            <Spinner size={20} />
          </div>
        </div>
      ) : !active && client.status === 'PENDING' && client.cases.length === 0 ? (
        <div className="card grid place-items-center gap-3 py-12 text-sm text-muted">
          <span>{t('Hali tekshirilmagan (navbatda, jonli tekshiruv yoʻq).')}</span>
          <button className="btn-primary" disabled={rechecking} onClick={openRecheck}>{rechecking ? <Spinner size={16} /> : <Ico.flash size={16} />} {t('Qayta tekshirish')}</button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {client.cases.map((k) => <CaseBig key={k.id} c={k} />)}
          {client.cases.length === 0 && <div className="card p-6 text-center text-sm text-muted">{t('Ijro ishi topilmadi (toza).')}</div>}
        </div>
      )}

      {/* Shu PINFL bo'yicha avtomator logi (SMS, xatolar...) — jonli */}
      <MibLogPanel q={client.pinfl} title="Shu PINFL — avtomator logi" defaultOpen={active} />
    </div>
  );
}

function CaseBig({ c }: { c: CaseRow }) {
  const t = useT();
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <span className="text-base font-semibold tabular-nums">{t('Ish')} № {c.workNumber}</span>
        {c.firmName && <span className={cx('badge', c.isTargetFirm ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300' : 'border-line text-muted')}>{shortFirm(c.firmName)}</span>}
      </div>
      {c.error && <div className="mb-2 text-xs text-rose-500">{c.error}</div>}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field l={t('Sud organi')} v={val(c.courtOrgan)} span />
        <Field l={t('Hujjat')} v={`${val(c.courtDocType)}${c.courtDocNumber && c.courtDocNumber !== 'Nomaʼlum' ? ' № ' + c.courtDocNumber : ''}`} />
        <Field l={t('Hujjat sanasi')} v={val(c.courtDocDate)} />
        <Field l={t('Kuchga kirgan')} v={val(c.courtEffectiveDate)} />
        <Field l={t('Davlat ijrochisi')} v={val(c.executorName)} />
        <Field l={t('Ijrochi tel')} v={val(c.executorPhone)} />
        <Field l={t('MIB boʻlimi')} v={val(c.executorDept)} />
        <Field l={t('MIBga kelgan')} v={val(c.mibReceivedDate)} />
        <Field l={t('Qoʻzgʻatilgan')} v={val(c.mibInitiatedDate)} />
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-2/50 p-3 text-sm sm:grid-cols-3">
        <Money l={t('Umumiy summa')} v={c.totalAmount} />
        <Money l={t('Asosiy qarz')} v={c.mainDebt} />
        <Money l={t('Ijro yigʻimi')} v={c.executionFee} />
        <Money l={t('Jarima')} v={c.fine} />
        <Money l={t('Qoldiq qarz')} v={c.remainingDebt} strong />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field l={t('Bank')} v={val(c.bankName)} span />
        <Field l={t('MFO / H/r')} v={`${val(c.bankMfo)} · ${val(c.bankAccount)}`} span />
      </dl>
      {c.decisions && c.decisions.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{t('Qarorlar')}</div>
          <ul className="space-y-0.5">{c.decisions.map((d, i) => <li key={i}>· {d.article} <span className="text-muted">{d.date}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Field({ l, v, strong, span }: { l: string; v: string; strong?: boolean; span?: boolean }) {
  return (
    <div className={cx('min-w-0', span && 'sm:col-span-2')}>
      <dt className="text-xs text-muted">{l}</dt>
      <dd className={cx('mt-0.5 break-words', strong ? 'font-semibold text-fg' : 'text-fg')}>{v}</dd>
    </div>
  );
}
function Money({ l, v, strong }: { l: string; v: string | null; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted">{l}</div>
      <div className={cx('tabular-nums', strong ? 'text-base font-semibold text-fg' : 'font-medium')}>{money(v)}</div>
    </div>
  );
}
