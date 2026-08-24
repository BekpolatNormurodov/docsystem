// billing.sud.uz «Mening kvitansiyalarim» (my-checks) ro'yxati — STIR yoki pasport bo'yicha,
// sahifalab. Bitta so'rov = bitta bir martalik recaptcha.sud.uz token (~2 daqiqa amal
// qiladi, qayta ishlatib bo'lmaydi — takroran ishlatilsa 422 "Failed captcha check").
// Shu sabab har sahifa/yangilash o'z tokenini oladi. Mexanizm src/lib/invoice-rest.ts dagi
// getCaptchaToken() bilan bir xil (recaptcha.sud.uz/api/v1/captcha/analyze), faqat
// `action` farq qiladi ("my_checks" vs "create_invoice") — shu modul o'zining kichik nusxasini
// olib yuradi, invoice yaratish oqimiga tegmaslik uchun.
const CAPTCHA_API = 'https://recaptcha.sud.uz/api/v1/captcha/analyze';
const SEARCH_API = 'https://billing.sud.uz/api/invoice/captcha/search';
const SITE_KEY = 'site_bbdb0625df8a200e73f37ebccf0c62ac';

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs = 20_000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        Origin: 'https://billing.sud.uz',
        Referer: 'https://billing.sud.uz/',
        'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
        ...(opts.headers as Record<string, string> | undefined),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

async function getSearchCaptchaToken(): Promise<string> {
  let lastMsg = 'token olinmadi';
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetchWithTimeout(CAPTCHA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
      body: JSON.stringify({ siteKey: SITE_KEY, action: 'my_checks', timestamp: Date.now(), signals: {} }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data.challengeRequired === false && data.token) return data.token as string;
    lastMsg = res.ok ? 'captcha challenge — skip/retry' : `analyze ${res.status}`;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(lastMsg);
}

export interface SearchInvoiceRow {
  number: string;
  invoiceStatus: string;
  amount: number | null;
  paidAmount: number | null;
  mustPayAmount: number | null;
  balance: number | null;
  payer: string | null;
  payerTin: string | null;
  court: string | null;
  courtId: number | null;
  forAccount: string | null;
  description: string | null;
  payCategory: string | null;
  claimCaseNumber: string | null;
  issued: number | null; // epoch ms — yaratilgan sana
  overdue: number | null; // epoch ms — amal qilish muddati (odatda issued + 30 kun)
  raw: unknown;
}

export interface SearchPage {
  content: SearchInvoiceRow[];
  pageNumber: number;
  pageSize: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
}

export interface SearchOpts {
  inn?: string;
  passportNumber?: string;
  page?: number;
  size?: number;
}

// GET /api/invoice/captcha/search?passportNumber=&inn=..&page=..&size=..&captchaToken=..
export async function searchMyChecks(opts: SearchOpts): Promise<SearchPage> {
  if (!opts.inn && !opts.passportNumber) throw new Error('STIR yoki pasport kerak');
  const token = await getSearchCaptchaToken();
  const params = new URLSearchParams({
    passportNumber: opts.passportNumber || '',
    inn: opts.inn || '',
    page: String(opts.page ?? 0),
    size: String(opts.size ?? 10),
    captchaToken: token,
  });
  const res = await fetchWithTimeout(`${SEARCH_API}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  const data: any = await res.json().catch(() => ({}));
  if (data?.requestStatus?.code && data.requestStatus.code !== 200) {
    throw new Error(`billing search ${data.requestStatus.code}: ${data.requestStatus.message}`);
  }
  if (!Array.isArray(data?.content)) throw new Error('billing search: kutilmagan javob');
  const content: SearchInvoiceRow[] = data.content.map((r: any) => ({
    number: String(r.number ?? ''),
    invoiceStatus: r.invoiceStatus ?? '',
    amount: r.amount ?? null,
    paidAmount: r.paidAmount ?? null,
    mustPayAmount: r.mustPayAmount ?? null,
    balance: r.balance ?? null,
    payer: r.payer ?? null,
    payerTin: r.payerTin ?? null,
    court: r.court ?? null,
    courtId: r.courtId ?? null,
    forAccount: r.forAccount ?? null,
    description: r.description ?? null,
    payCategory: r.payCategory ?? null,
    claimCaseNumber: r.claimCaseNumber ?? null,
    issued: r.issued ?? null,
    overdue: r.overdue ?? null,
    raw: r,
  }));
  return {
    content,
    pageNumber: data.pageNumber ?? opts.page ?? 0,
    pageSize: data.pageSize ?? opts.size ?? 10,
    totalElements: data.totalElements ?? content.length,
    totalPages: data.totalPages ?? 1,
    last: data.last ?? true,
  };
}
