// Kredit to'lash grafigi — PDF (sud paketi uchun).
//
// NEGA: 2026-09-08 gacha imzolangan arizalarning «Ilova qilingan hujjatlar ro'yxati»da 5-band
// «Kredit to'lash grafigi nusxasi» turibdi (ro'yxatdan keyin olib tashlangan, lekin allaqachon
// imzolangan/skanerlangan arizalar o'zgarmaydi). Sudga esa grafik hech qachon ketmasdi — ariza
// va'da qilgan ilova yo'q. ADOLAT faqat PDF qabul qiladi; mavjud generator (grafik-docx.ts) esa DOCX.
//
// Raqamlar grafik-docx.ts bilan AYNAN bir xil (loanSchedule / loanMaturity / termMonths) — DOCX,
// oferta «тўлиқ қиймати» va shu PDF tiyinigacha mos keladi. Yon ta'sirsiz: bazaga tegmaydi.
import type { Browser } from 'playwright';
import { hasActualClose, loanMaturity, loanSchedule, termMonths, type GrafikLoan } from './grafik-docx';

export interface GrafikPdfInput {
  /** BITTA mijoz × firma kreditlari (odatda shu snapshot + pinfl + kod). Sud uchun avval
   *  `withActualClose()` (loan-actual-close.ts) dan o'tkazing — joriy portfelda haqiqiy muddat yo'q. */
  loans: GrafikLoan[];
  clientName: string | null;
  firmName: string;
}

export interface GrafikOpts {
  /** true (sukut): `raw.date_actu_close` bo'lmagan kredit TASHLANADI. Aks holda muddat kredit
   *  liniyasidan (72 oy) olinib, sudga noto'g'ri grafik ketardi. false — eski xatti-harakat. */
  requireActualClose?: boolean;
  /** Tashlangan kredit haqida xabar (logga yozish uchun). */
  onSkip?: (ldId: string | null, reason: string) => void;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/ | /g, ' ');
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Bitta kredit bloki (sarlavha qatori + jadval). Grafik tuzib bo'lmasa — null. */
function loanBlock(l: GrafikLoan): string | null {
  const principal = Math.round(num(l.summKr));
  const rate = num(l.rate);
  const mat = loanMaturity(l);
  // grafik-docx.ts bilan bir xil himoya: summa > 0, ikkala sana bor va tartibi to'g'ri.
  if (principal <= 0 || !l.dateToCr || !mat || mat <= l.dateToCr) return null;
  const months = termMonths(l.dateToCr, mat);
  const s = loanSchedule(principal, rate, l.dateToCr, months);
  if (!s.rows.length) return null;
  const rows = s.rows.map((r) => `<tr><td>${r.n}</td><td>${dmy(r.date)}</td><td class="r">${money(r.balance)}</td>`
    + `<td class="r">${money(r.principal)}</td><td class="r">${money(r.interest)}</td><td class="r">${money(r.payment)}</td></tr>`).join('');
  return `<section class="loan">
  <p class="lh">Shartnoma № ${esc(l.ldId ?? '—')} — ${money(principal)} soʻm, yillik ${esc(rate)}%, ${months} oy (${dmy(l.dateToCr)} — ${dmy(mat)})</p>
  <table>
    <thead><tr><th style="width:6%">№</th><th style="width:17%">Toʻlov sanasi</th><th style="width:21%">Qoldiq</th><th style="width:20%">Asosiy qarz</th><th style="width:18%">Foizlar</th><th style="width:18%">Jami</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="t"><td></td><td>Jami</td><td></td><td class="r">${money(principal)}</td><td class="r">${money(s.totalInterest)}</td><td class="r">${money(s.total)}</td></tr></tfoot>
  </table>
</section>`;
}

/**
 * Sof funksiya: grafik HTML'i. Har kredit alohida himoyalangan — bitta buzuq kredit (yaroqsiz
 * sana, NaN) qolganlarini to'xtatmaydi, faqat tashlab ketiladi. `loanCount` — chiqqan bloklar soni.
 */
export function buildGrafikHtml(input: GrafikPdfInput, opts: GrafikOpts = {}): { html: string; loanCount: number } {
  const strict = opts.requireActualClose !== false;
  const blocks: string[] = [];
  for (const l of input.loans ?? []) {
    try {
      if (strict && !hasActualClose(l.raw)) { opts.onSkip?.(l.ldId, 'haqiqiy yopilish sanasi (date_actu_close) yoq'); continue; }
      const b = loanBlock(l);
      if (b) blocks.push(b); else opts.onSkip?.(l.ldId, 'summa yoki sanalar yaroqsiz');
    } catch (e) {
      opts.onSkip?.(l.ldId, e instanceof Error ? e.message : String(e)); // shu kredit tashlanadi
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", "Liberation Serif", "DejaVu Serif", serif; font-size: 10pt; color: #000; margin: 0; }
  h1 { text-align: center; font-size: 14pt; margin: 0 0 4pt; letter-spacing: .5pt; }
  .firm { text-align: center; font-weight: bold; font-size: 11pt; margin: 0 0 2pt; }
  .client { text-align: center; font-size: 11pt; margin: 0 0 10pt; }
  .loan { margin-top: 8pt; }
  .lh { font-weight: bold; margin: 0 0 3pt; font-size: 10pt; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; } tfoot { display: table-row-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 0.6pt solid #000; padding: 1.5pt 3pt; text-align: center; font-size: 9pt; }
  th { font-weight: bold; }
  td.r { text-align: right; white-space: nowrap; }
  tr.t td { font-weight: bold; }
</style></head><body>
  <h1>KREDIT TOʻLASH GRAFIGI</h1>
  <p class="firm">${esc(input.firmName)}</p>
  <p class="client">Qarzdor: ${esc(input.clientName ?? '—')}</p>
  ${blocks.join('\n')}
</body></html>`;
  return { html, loanCount: blocks.length };
}

/**
 * Grafik PDF (A4, har sahifada «sahifa X / Y»). Grafik tuzib bo'ladigan kredit bo'lmasa — null.
 * `browser` berilsa, faqat o'zi ochgan sahifani yopadi; berilmasa Chromium'ni o'zi ochadi va yopadi.
 */
export async function buildGrafikPdf(input: GrafikPdfInput, opts: GrafikOpts & { browser?: Browser } = {}): Promise<Buffer | null> {
  const { html, loanCount } = buildGrafikHtml(input, opts);
  if (!loanCount) return null;

  let ownBrowser: Browser | null = null;
  const browser = opts.browser ?? (ownBrowser = await (await import('playwright')).chromium.launch({ headless: true }));
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;text-align:center;font-size:8pt;font-family:serif;">sahifa <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (ownBrowser) await ownBrowser.close().catch(() => {});
  }
}
