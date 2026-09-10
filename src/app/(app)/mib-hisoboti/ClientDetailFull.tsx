'use client';

// Bitta mijozning TO'LIQ detal ko'rinishi — alohida sahifa (/mib-hisoboti/mijoz/[id]) va konveyer
// modalining ichki ko'rinishi ikkalasi ham shuni ishlatadi. O'zi /api/mib/client/[cid] dan o'qiydi va
// tekshiruv ketayotganda (PENDING/RUNNING) jonli yangilanadi — shuning uchun bitta PINFL qo'shib,
// uning sahifasida natija to'lishini kuzatish mumkin.
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Ico, Spinner } from '@/ui';
import { money, val, type ClientRow, type CaseRow } from './MibClientDetail';
import { regionOf, parseMoney, clean, shortFirm } from '@/lib/mib/breakdown';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');
const som = (x: number) => (x || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const STATUS_LABEL: Record<string, string> = { PENDING: 'Navbatda', RUNNING: 'Tekshirilmoqda', DONE: 'Topildi', CLEAN: 'Toza', FAILED: 'Xato' };

export function ClientDetailFull({ reportId, clientId, backHref, onBack }: { reportId: number; clientId: number; backHref?: string; onBack?: () => void }) {
  const [client, setClient] = useState<ClientRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/mib/client/${clientId}`, { cache: 'no-store' });
    if (r.status === 404) { setMissing(true); setLoading(false); return; }
    const j = await r.json().catch(() => null);
    setClient(j?.client ?? null); setLoading(false);
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  // Tekshiruv ketayotganda jonli yangilanish.
  const active = !!client && (client.status === 'PENDING' || client.status === 'RUNNING');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 3500);
    return () => clearInterval(t);
  }, [active, load]);

  const back = backHref
    ? <Link href={backHref} className="btn-ghost"><Ico.chevronLeft size={16} /> Roʻyxatga qaytish</Link>
    : <button onClick={onBack} className="btn-ghost"><Ico.chevronLeft size={16} /> Roʻyxatga qaytish</button>;

  if (loading) return <div className="space-y-4">{back}<div className="grid place-items-center py-20"><Spinner /></div></div>;
  if (missing || !client) return <div className="space-y-4">{back}<div className="card p-10 text-center text-sm text-muted">Mijoz topilmadi.</div></div>;

  const fullName = client.cases.map((k) => k.personFullName).find((nm) => nm && !nm.includes('***') && nm !== 'Nomaʼlum') || clean(client.fio2) || clean(client.fio) || client.pinfl;
  const hasDetail = client.cases.some((k) => k.detailFetchedAt);
  const region = regionOf(client);
  const banks = [...new Set(client.cases.map((k) => clean(k.bankName)).filter(Boolean))];
  const depts = [...new Set(client.cases.map((k) => clean(k.executorDept)).filter(Boolean))];
  const remaining = client.cases.reduce((s, k) => s + parseMoney(k.remainingDebt), 0);
  const ours = client.cases.filter((k) => k.isTargetFirm).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <a className="btn-ghost text-xs" href={`/api/mib/${reportId}/excel?client=${client.id}`}><Ico.download size={14} /> Shu mijoz — Excel</a>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{fullName}</h3>
            <div className="mt-0.5 text-sm text-muted tabular-nums">PINFL: {client.pinfl}{client.firm ? ` · ${client.firm}` : ''}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {active && <span className="badge border-amber-500/30 text-amber-600 dark:text-amber-300"><Spinner size={11} className="mr-1" /> {STATUS_LABEL[client.status]}</span>}
            {client.cases.length > 0 && <span className="badge border-brand-500/30 text-brand-600 dark:text-brand-400">{client.cases.length} ijro ishi</span>}
            {ours > 0 && <span className="badge border-emerald-500/30 text-emerald-600 dark:text-emerald-300">{ours} bizniki</span>}
          </div>
        </div>
        {client.error && <div className="mt-2 text-xs text-rose-500">{client.error}</div>}
        {!hasDetail && client.cases.length > 0 && <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">Chuqur detal (SMS) hali olinmagan — faqat ijro ishlari roʻyxati.</div>}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Field l="Region" v={region ?? '—'} />
          <Field l="Hudud (MIB boʻlimi)" v={depts.join(', ') || '—'} />
          <Field l="Bank" v={banks.join(', ') || '—'} />
          <Field l="Umumiy qarz (mib)" v={money(client.totalDebt)} strong />
          <Field l="Qoldiq qarz — jami" v={remaining > 0 ? som(remaining) : '—'} strong />
        </dl>
      </div>

      {active && client.cases.length === 0 ? (
        <div className="card grid place-items-center gap-2 py-14 text-sm text-muted">
          <Spinner /> mib.uz dan tekshirilmoqda… natija shu yerda paydo boʻladi.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {client.cases.map((k) => <CaseBig key={k.id} c={k} />)}
          {client.cases.length === 0 && <div className="card p-6 text-center text-sm text-muted">Ijro ishi topilmadi (toza).</div>}
        </div>
      )}
    </div>
  );
}

function CaseBig({ c }: { c: CaseRow }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <span className="text-base font-semibold tabular-nums">Ish № {c.workNumber}</span>
        {c.firmName && <span className={cx('badge', c.isTargetFirm ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300' : 'border-line text-muted')}>{shortFirm(c.firmName)}</span>}
      </div>
      {c.error && <div className="mb-2 text-xs text-rose-500">{c.error}</div>}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field l="Sud organi" v={val(c.courtOrgan)} span />
        <Field l="Hujjat" v={`${val(c.courtDocType)}${c.courtDocNumber && c.courtDocNumber !== 'Nomaʼlum' ? ' № ' + c.courtDocNumber : ''}`} />
        <Field l="Hujjat sanasi" v={val(c.courtDocDate)} />
        <Field l="Kuchga kirgan" v={val(c.courtEffectiveDate)} />
        <Field l="Davlat ijrochisi" v={val(c.executorName)} />
        <Field l="Ijrochi tel" v={val(c.executorPhone)} />
        <Field l="MIB boʻlimi" v={val(c.executorDept)} />
        <Field l="MIBga kelgan" v={val(c.mibReceivedDate)} />
        <Field l="Qoʻzgʻatilgan" v={val(c.mibInitiatedDate)} />
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-2/50 p-3 text-sm sm:grid-cols-3">
        <Money l="Umumiy summa" v={c.totalAmount} />
        <Money l="Asosiy qarz" v={c.mainDebt} />
        <Money l="Ijro yigʻimi" v={c.executionFee} />
        <Money l="Jarima" v={c.fine} />
        <Money l="Qoldiq qarz" v={c.remainingDebt} strong />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field l="Bank" v={val(c.bankName)} span />
        <Field l="MFO / H/r" v={`${val(c.bankMfo)} · ${val(c.bankAccount)}`} span />
      </dl>
      {c.decisions && c.decisions.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Qarorlar</div>
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
