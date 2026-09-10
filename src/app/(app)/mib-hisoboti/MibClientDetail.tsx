'use client';

// MIB ijro ishi — mijoz detali (bitta PINFL bo'yicha barcha ijro ishlari kartalari).
// MibReport (standalone) va MibDashboard (konveyer + standalone) ikkalasi ham shu yerdan
// import qiladi — aylanma (circular) importdan qochish uchun alohida modul.
import React from 'react';

export interface CaseRow {
  id: number; workNumber: string; monitoringUrl: string | null;
  personFullName: string | null; creditor: string | null; firmName: string | null; firmInn: string | null; isTargetFirm: boolean;
  executorName: string | null; executorPhone: string | null; executorDept: string | null;
  courtOrgan: string | null; courtDocType: string | null; courtDocNumber: string | null; courtDocDate: string | null; courtEffectiveDate: string | null; caseSubject: string | null;
  mibReceivedDate: string | null; mibInitiatedDate: string | null;
  totalAmount: string | null; mainDebt: string | null; executionFee: string | null; fine: string | null; remainingDebt: string | null;
  bankName: string | null; bankMfo: string | null; bankAccount: string | null;
  decisions: { article: string; date: string }[] | null;
  detailFetchedAt: string | null; error: string | null;
}
export interface ClientRow {
  id: number; rowNo: number | null; pinfl: string; fio: string | null; firm: string | null; ishRaqami: string | null;
  holat: string | null; region: string | null; status: string; attempts: number; fio2: string | null;
  totalDebt: string | null; error: string | null; checkedAt: string | null; cases: CaseRow[];
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export const money = (s: string | null) => {
  if (!s || s === 'Nomaʼlum') return '—';
  const v = Number(String(s).replace(/[^\d.-]/g, ''));
  return Number.isFinite(v) ? v.toLocaleString('ru-RU') : s;
};
export const val = (v: string | null) => (v && v !== 'Nomaʼlum' ? v : '—');

export function ClientDetail({ client, hasDetail }: { client: ClientRow; hasDetail: boolean }) {
  const fullName = client.cases.map((k) => k.personFullName).find((nm) => nm && !nm.includes('***') && nm !== 'Nomaʼlum');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {fullName && <span><span className="text-muted">To‘liq ism: </span><b>{fullName}</b></span>}
        {client.totalDebt && <span><span className="text-muted">Umumiy qarz (mib): </span><b className="tabular-nums">{money(client.totalDebt)}</b></span>}
      </div>
      {!hasDetail && <div className="text-xs text-amber-600 dark:text-amber-300">Chuqur detal (SMS) hali olinmagan — faqat ijro ishlari ro‘yxati.</div>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {client.cases.map((k) => <CaseCard key={k.id} c={k} />)}
      </div>
    </div>
  );
}

function DRow({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return (<><dt className="text-muted">{l}</dt><dd className={cx('tabular-nums', strong && 'font-semibold text-fg')}>{v}</dd></>);
}

function CaseCard({ c }: { c: CaseRow }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">Ish № {c.workNumber}</span>
        {c.firmName && <span className={cx('badge', c.isTargetFirm ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300' : 'border-line text-muted')}>{c.firmName.replace(/ MIKROMOLIYA.*$/i, '')}</span>}
      </div>
      {c.error && <div className="mb-2 text-xs text-rose-500">{c.error}</div>}
      <dl className="grid grid-cols-[118px_1fr] gap-x-3 gap-y-1 text-xs">
        <DRow l="Sud organi" v={val(c.courtOrgan)} />
        <DRow l="Hujjat" v={`${val(c.courtDocType)}${c.courtDocNumber && c.courtDocNumber !== 'Nomaʼlum' ? ' № ' + c.courtDocNumber : ''}`} />
        <DRow l="Hujjat sanasi" v={val(c.courtDocDate)} />
        <DRow l="Kuchga kirgan" v={val(c.courtEffectiveDate)} />
        <DRow l="Ijrochi" v={val(c.executorName)} />
        <DRow l="Ijrochi tel" v={val(c.executorPhone)} />
        <DRow l="MIB bo‘limi" v={val(c.executorDept)} />
        <DRow l="MIBga kelgan" v={val(c.mibReceivedDate)} />
        <DRow l="Qo‘zg‘atilgan" v={val(c.mibInitiatedDate)} />
        <DRow l="Umumiy summa" v={money(c.totalAmount)} />
        <DRow l="Asosiy qarz" v={money(c.mainDebt)} />
        <DRow l="Ijro yig‘imi" v={money(c.executionFee)} />
        <DRow l="Jarima" v={money(c.fine)} />
        <DRow l="Qoldiq qarz" v={money(c.remainingDebt)} strong />
        <DRow l="Bank" v={val(c.bankName)} />
        <DRow l="MFO / H/r" v={`${val(c.bankMfo)} · ${val(c.bankAccount)}`} />
      </dl>
      {c.decisions && c.decisions.length > 0 && (
        <div className="mt-2 border-t border-line pt-2 text-xs">
          <div className="mb-1 text-muted">Qarorlar:</div>
          <ul className="space-y-0.5">{c.decisions.map((d, i) => <li key={i}>· {d.article} <span className="text-muted">{d.date}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
