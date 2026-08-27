'use client';

import { useState } from 'react';

/**
 * «Izoh» — har bir excel yuklash yonida bosiladigan kichik tugma; ochilganda o'sha fayl qaysi
 * ustunlardan iborat bo'lishi kerakligini tushuntiradi. Ma'lumot parserlardan olingan:
 *  · portfel  → src/core/portfolio.ts (mapRowToLoan)
 *  · sud      → src/lib/parse-exclusion.ts («ПНФЛ» varag'i, 1-ustun)
 *  · talabnoma→ src/lib/talabnoma-form/parse.ts (Лист1)
 */
export type DocInfoKind = 'portfel' | 'sud' | 'talabnoma';

const INFO: Record<DocInfoKind, { title: string; intro: string; rows: [string, string][]; note?: string }> = {
  portfel: {
    title: 'Portfel fayli — ustunlar',
    intro: '1-qator = sarlavha. Ustun nomlari lotincha, kichik harf. «pinfl» majburiy (varaq shu bilan aniqlanadi). Bank eksportini o‘zgartirmasdan yuklang.',
    rows: [
      ['pinfl', 'PINFL — majburiy'],
      ['client_name', 'F.I.Sh'],
      ['passport_sn', 'Passport seriya-raqam'],
      ['phone_mobile', 'Telefon'],
      ['post_address', 'Manzil'],
      ['name / distr_name', 'Viloyat / Tuman'],
      ['branch', 'Firma kodi'],
      ['ld_id', 'Shartnoma raqami'],
      ['account', 'Hisob raqami'],
      ['summ_kr', 'Kredit summasi'],
      ['rate', 'Foiz'],
      ['date_to_cr / date_close', 'Berilgan / yopilish sanasi'],
      ['klass_name, status_name, term_type', 'Klass / status / muddat turi'],
      ['summ_ost_ze', 'Asosiy qarz qoldig‘i'],
      ['sumproc_eqv', 'Muddatli foiz'],
      ['summ_ostpr_ze', 'Muddati o‘tgan asosiy'],
      ['sumnachpr_eqv', 'Muddati o‘tgan foiz'],
    ],
  },
  sud: {
    title: 'Sud (muammoli / istisno) ro‘yxati — ustunlar',
    intro: 'Eng oddiy fayl. Varaq nomi «ПНФЛ» yoki «ПИНФЛ» bo‘lsin (yoki 1-ustun sarlavhasi shunday). Faqat A ustuni (1-ustun) o‘qiladi — har qatorda bitta PINFL.',
    rows: [
      ['A (1-ustun)', 'PINFL — sudga chiqadigan mijozlar ro‘yxati'],
    ],
    note: '1-qator sarlavha, ma’lumot 2-qatordan. Boshqa ustunlar e’tiborga olinmaydi. Bu fayl endi IXTIYORIY — keyin ham qo‘shsa bo‘ladi.',
  },
  talabnoma: {
    title: 'Talabnoma ro‘yxati — ustunlar (Лист1)',
    intro: 'Har qatorda bitta odam, 1-qator sarlavha. Ustunlar tartibi (A→K):',
    rows: [
      ['1 (A)', 'PINFL'],
      ['2 (B)', 'F.I.Sh'],
      ['6 (F)', 'Umumiy muddati o‘tgan qarz'],
      ['7 (G)', 'Manzil'],
      ['8 (H)', 'Telefon'],
      ['9 (I)', 'Viloyat'],
      ['10 (J)', 'Tuman'],
      ['11 (K)', 'Firmalar (matn)'],
    ],
    note: 'Лист2 — har (firma × kredit): 2-ustun = firma kodi, 10-ustun (J) = PINFL.',
  },
};

/** Kichik «majburiy» / «ixtiyoriy» yorlig'i — required va optional fayllar ko'zga farqli tursin. */
export function ReqChip({ required }: { required: boolean }) {
  return required ? (
    <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">majburiy</span>
  ) : (
    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">ixtiyoriy</span>
  );
}

export function DocInfo({ kind }: { kind: DocInfoKind }) {
  const [open, setOpen] = useState(false);
  const d = INFO[kind];
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:border-brand-500/40 hover:text-fg"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
        izoh
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-50 mt-1.5 flex max-h-[60vh] w-[32rem] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <div className="border-b border-line px-3 py-2">
              <div className="text-xs font-semibold">{d.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">{d.intro}</p>
            </div>
            <div className="overflow-y-auto p-3">
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-left text-[11px]">
                <tbody className="divide-y divide-line">
                  {d.rows.map(([col, mean]) => (
                    <tr key={col}>
                      <td className="w-1/2 px-2 py-1 align-top font-mono font-medium text-fg">{col}</td>
                      <td className="px-2 py-1 align-top text-muted">{mean}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.note && <p className="mt-2 text-[11px] leading-relaxed text-muted">{d.note}</p>}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
