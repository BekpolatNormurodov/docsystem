// Per-LOAN «Online mikroqarz oferta» PDF. The oferta is an UNSIGNED public offer
// (accepted electronically on the lender's platform), so a generated copy is
// legitimate — only the loan-specific fields change; the boilerplate is fixed in
// oferta-template.html (a faithful reproduction of the firm's real oferta). Filled +
// rendered to PDF via chromium (same pipeline as the talabnoma).
//
// Term/full-value: the term comes from the REAL close (`date_actu_close` in the raw
// portfolio row → true 12/24/36-month product term) via loanMaturity/termMonths, and the
// full value is the annuity total over that term — the SAME engine as the grafik, so the
// two documents stay identical. Insurance («таъминот») is set by the insurer at contract
// time and is NOT in the portfolio; it comes in as a % (default 0) the firm can configure —
// when unset, the cell shows the policy text (with the insurer, if known) and no invented sum.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import { loanSchedule, loanMaturity, termMonths } from './grafik-docx';

// Money as the reference prints it: space-grouped, comma decimals, exactly 2 places
// (e.g. «2 000 000,00»). ru-RU groups with a non-breaking space and uses a comma decimal.
const money = (n: number) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100);

// mtime-aware template cache (edits take effect without a restart, no stale footgun).
const TEMPLATE_PATH = path.join(process.cwd(), 'src/lib/oferta-template.html');
let TEMPLATE: string | null = null;
let TEMPLATE_MTIME = 0;
const template = (): string => {
  const mtime = fs.statSync(TEMPLATE_PATH).mtimeMs;
  if (TEMPLATE === null || mtime !== TEMPLATE_MTIME) { TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8'); TEMPLATE_MTIME = mtime; }
  return TEMPLATE;
};

// Per-firm legal address for the oferta реквизит, keyed by branch code. The firms' OWN ofertas
// wrongly print BRIGHT's Tashkent address for everyone (a template constant); these are the real
// registered addresses per firm (from the operator). BRIGHT keeps its Tashkent HQ + contact.
const OFERTA_REQV: Record<string, string> = {
  '12842': 'г. Ташкент, Алмазарский район, Гуручарик МФЙ, Сагбон 30 тупик, дом 7/1. Контакт: 71-231-97-01', // BRIGHT FUTURE FINANCING
  '06292': 'Фарғона вилояти, Фарғона шаҳар, Навруз МФЙ, Университет кўчаси 24/4', // URBAN FINANCE SOLUTIONS
  '14276': 'Самарқанд вилояти, Самарқанд шаҳри, Мирзо Бедил МФЙ, Буюк ипак йўли кўчаси, 41-уй, 19-хонадон', // FUNDFLOW
  '55890': 'Андижон вилояти, Андижон шаҳар, ул Бобуршох 20/г', // COMMUNITY MICROFINANCE
  '31685': 'Қашқадарё вилояти, Қарши шаҳри, Ғафур Ғулом МФЙ, Ғузор кўчаси, 14 уй', // ZAYMLY
  '05557': 'г. Ташкент, Алмазарский район, Гуручарик МФЙ, Сагбон 30 тупик, дом 7/1', // MUVAFFAQIYAT
};

export interface OfertaFirm {
  code?: string | null;
  legalName?: string | null; shortName?: string | null; address?: string | null;
  stir?: string | null; bankAccount?: string | null; mfo?: string | null;
}
export interface OfertaLoan {
  ldId: string | null; summKr: unknown; rate: unknown; dateToCr: Date | null; dateClose: Date | null;
  raw?: unknown; // full portfolio row — carries `date_actu_close` (real close) and the insurer name
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Build the {{token}} → value map for one loan's oferta. */
export function ofertaFields(loan: OfertaLoan, firm: OfertaFirm, clientName: string | null, pinfl: string | null, insurancePct = 0): Record<string, string> {
  const principal = Math.round(Number(loan.summKr) || 0);
  const rate = Number(loan.rate) || 0;
  // Term from the REAL close (same source as the grafik) → 12/24/36 mo; fall back to 12.
  const start = loan.dateToCr;
  const mat = loanMaturity(loan);
  const term = start && mat && mat > start ? termMonths(start, mat) : 12;
  // «Тўлиқ қиймати» = the firm's real repayment schedule total (1-month interest-only grace,
  // annuity over term−1, daily 365-basis interest, 5th-of-month business-day installments) —
  // reproduces the reference oferta to the tiyin. Same engine as the printed grafik.
  // «Тўлиқ қиймати» must be reproducible — the schedule is anchored to the disburse date, so NEVER
  // anchor it to today (new Date()) when dateToCr is missing, or the same unchanged loan prints a
  // different total on every render. No stored date → fall back to the bare principal (no invented,
  // date-dependent interest) rather than a moving figure on a legal document.
  const fullValue = start ? loanSchedule(principal, rate, start, term).total : principal;

  // Таъминот (insurance premium) is NOT a stored portfolio column — but the insured sum
  // (`sumguarr`) is. The premium equals 4% of that insured sum, which is 19% of principal on
  // the common 4.75× guarantee tier and reproduces the firm's reference oferta (380 000 for a
  // 2 000 000 loan; 817 000 for 4 300 000). An explicit insurancePct overrides (principal ×
  // pct); otherwise derive 4% × sumguarr, falling back to 19% × principal when sumguarr is absent.
  const raw = (loan.raw ?? null) as Record<string, unknown> | null;
  const sumguarr = raw ? Number(raw['sumguarr']) || 0 : 0;
  const insurance = insurancePct > 0
    ? Math.round(principal * (insurancePct / 100))
    : sumguarr > 0 ? Math.round(sumguarr * 0.04) : Math.round(principal * 0.19);
  const insurer = raw ? String(raw['nameguarr'] || raw['name_actu'] || '').trim() : '';
  const insuranceCell = insurance > 0
    ? `${money(insurance)} сўм миқдоридаги микроқарзни тўламаслик хавфидан суғурталаш полиси.`
    : `Микроқарзни тўламаслик хавфидан суғурталаш полиси${insurer ? ` (${insurer})` : ''}.`;

  // Heading uses the full legal name; the ММТ definition/footer use the name without the
  // «» / MCHJ org-form wrapper (so «{{firm_name}} микромолия ташкилоти» reads cleanly).
  const legal = (firm.legalName || firm.shortName || '').trim();
  const firmName = legal.replace(/^«|»\s*(MCHJ|МЧЖ)?\s*$/gi, '').replace(/^«|»$/g, '').trim();
  // Реквизит: the firm's OWN registered legal address (per branch code). The firms' real ofertas
  // wrongly print BRIGHT's Tashkent address for everyone; we use each firm's true address instead.
  // Unknown firm → fall back to the DB address so the line is never blank.
  const reqv = (firm.code && OFERTA_REQV[firm.code]) || firm.address || '—';

  // Электрон ҳамён account — the reference oferta prints a FIXED masked account «(22616…200)»
  // IDENTICALLY for every client (verified across all 17 real ofertas; it matches neither the
  // portfolio `account` 14801… nor `acc_over` 12405…), so it is a template constant, not
  // per-client data. Reproduce it verbatim so the line matches the firm's oferta to the character.
  const ewalletAcc = ' (22616…200)';
  return {
    firm_title: esc(legal || firmName || 'ММТ'),
    firm_name: esc(firmName || 'ММТ'),
    client_name: esc(clientName || '—'),
    client_pinfl: esc(pinfl || '—'),
    loan_amount: money(principal),
    loan_term: String(term),
    rate: String(rate),
    full_value: money(fullValue),
    insurance: money(insurance),
    insurance_cell: esc(insuranceCell),
    firm_reqvizit: esc(reqv),
    firm_contact: '',
    ewallet_acc: esc(ewalletAcc),
  };
}

export function fillOferta(loan: OfertaLoan, firm: OfertaFirm, clientName: string | null, pinfl: string | null, insurancePct = 0): string {
  const f = ofertaFields(loan, firm, clientName, pinfl, insurancePct);
  return template().replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => f[key] ?? '');
}

/** Render one loan's oferta to a PDF buffer. Pass a shared `browser` for batches. */
export async function renderOfertaPdf(loan: OfertaLoan, firm: OfertaFirm, browser: Browser, clientName: string | null, pinfl: string | null, insurancePct = 0): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(fillOferta(loan, firm, clientName, pinfl, insurancePct), { waitUntil: 'networkidle' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '16mm', right: '16mm' } });
  } finally {
    await page.close();
  }
}
