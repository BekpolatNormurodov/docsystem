// Map debt-gated talabnoma rows → xat.hippo internal «mails» (the reyestr the template flow
// imports), WITHOUT going through an .xlsx round-trip. Produces the exact same content shape as
// `readInternalMailsFromExcel`: the SPECIAL columns (receiver/address/region/area) become the
// mail's own fields; every other template column goes into the JSON `content` blob hippo fills
// into the template. Values are stringified the same way the Excel importer normalizes them
// (dates → YYYY-MM-DD, numbers as plain strings) so a direct send and an Excel upload are
// byte-identical on hippo's side.
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from './session';
import { loadTalabnomaRowsForScope } from './talabnoma-bulk';
import { resolveContext, checkBalanceFor, createRegistryInternal, listRegistries, type InternalMail } from './xat';
import { getSentTalabnomaPinfls, splitBySent, recordSentTalabnomas } from './talabnoma-trace';
import type { TalabnomaRow } from './talabnoma-excel';

const pad = (x: number) => String(x).padStart(2, '0');
// LOCAL components — matches xat.normVal (toISOString() is UTC and can shift the day by one).
const ymd = (d: Date | null): string => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');

/**
 * Build one InternalMail per talabnoma row for `createRegistryInternal`.
 * `templateName` must be the hippo template name (resolved via `resolveContext`).
 * Rows are assumed already debt-gated (total_debt > 0) by loadTalabnomaRowsForScope.
 */
export function talabnomaRowsToMails(rows: TalabnomaRow[], templateName: string): InternalMail[] {
  return rows.map((r) => {
    // Non-SPECIAL template variables — the same set the Excel importer keeps in `content`.
    const content: Record<string, string> = {
      date: ymd(r.date),
      contract_id: r.contract_id,
      contract_date: ymd(r.contract_date),
      contract_number: r.contract_number,
      loan_amount: String(r.loan_amount),
      loan_amount_words: r.loan_amount_words,
      total_debt: String(r.total_debt),
      total_debt_words: r.total_debt_words,
    };
    const customId = String(r.contract_id ?? '').trim();
    return {
      receiver: r.receiver,
      regionId: r.region,
      areaId: r.area,
      address: r.address,
      content: JSON.stringify(content),
      templateName,
      custom_id: customId || null,
      ...(customId ? { clientCustomId: customId } : {}),
    };
  });
}

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

export type SendMode = 'draft' | 'send';

export interface SendTalabnomaOpts {
  snapshotId: number;
  firmId: number;
  // 'draft' (default, SAFE): uploads the reyestr to xat.hippo as a DRAFT registry — nothing is
  //   dispatched; the operator reviews and sends from hippo. 'send': autoSend — hippo dispatches
  //   the letters immediately (may cost money on a paid tariff). The caller (route/bot) decides.
  mode?: SendMode;
  // Cap: send only the first `limit` talabnomalar (debt-gated order). Omitted/0 → hammasi.
  limit?: number;
}

export interface SendTalabnomaResult {
  ok: boolean;
  mode: SendMode;
  count: number;               // mails put into the registry (this batch)
  balance: number;             // wallet balance (so'm) at send time
  free: boolean;               // tariff makes sending free (pricePerMail === 0)
  required: number;            // pricePerMail * count
  enough: boolean;             // spendable >= required
  registryId?: string | number | null;
  firmName?: string | null;
  remaining?: number;          // still-unsent talabnomalar AFTER this batch
  error?: string;
}

const fail = (mode: SendMode, error: string, extra: Partial<SendTalabnomaResult> = {}): SendTalabnomaResult => ({
  ok: false, mode, count: 0, balance: 0, free: false, required: 0, enough: false, ...extra, error,
});

/**
 * Orchestrate a talabnoma reyestr → xat.hippo, as ONE reusable server function (the route and the
 * bot both call this — no logic in the HTTP layer). Steps: resolve the firm's live hippo session →
 * load the firm's debt-gated rows (0-som clients already dropped) → resolve template/org/branch →
 * check the wallet → build the mails → create the registry. `mode:'draft'` (default) creates a
 * DRAFT (autoSend:false) so nothing is dispatched until a human confirms on hippo; `mode:'send'`
 * sets autoSend and is refused when the balance can't cover it. Never throws — every failure comes
 * back as { ok:false, error }.
 */
// In-process lock per (snapshot, firm): the dedupe is a read-modify-write across several awaits
// (getSentTalabnomaPinfls → … → createRegistryInternal → recordSentTalabnomas), so two concurrent or
// double-clicked sends could both read an empty «iz», grab the SAME first-N unsent clients and
// DISPATCH twice. Serialize per scope — a second concurrent call is refused, not queued.
const inFlightSends = new Set<string>();

export async function sendTalabnomaToHippo(opts: SendTalabnomaOpts): Promise<SendTalabnomaResult> {
  const mode: SendMode = opts.mode === 'send' ? 'send' : 'draft';
  const lockKey = `${opts.snapshotId}:${opts.firmId}`;
  if (inFlightSends.has(lockKey)) return fail(mode, 'Bu firma boʻyicha joʻnatish allaqachon ketmoqda — kuting');
  inFlightSends.add(lockKey);
  try {
  const firm = await prisma.firm.findUnique({ where: { id: opts.firmId }, select: { stir: true, shortName: true, code: true } });
  if (!firm) return fail(mode, 'Firma topilmadi');
  const firmName = firm.shortName ?? null;

  let session;
  try {
    session = await getStoredHippoSession(digits(firm.stir));
  } catch {
    return fail(mode, 'Firma xat.hippo ga ulanmagan — «Ula» bosing', { firmName });
  }

  let rows: TalabnomaRow[];
  try {
    ({ rows } = await loadTalabnomaRowsForScope({ snapshotId: opts.snapshotId, firmId: opts.firmId }));
  } catch (e) {
    return fail(mode, e instanceof Error ? e.message : 'Talabnoma yuklanmadi', { firmName });
  }
  if (rows.length === 0) return fail(mode, 'Talabnoma qatori yoʻq (qarzdorlik 0 yoki maʼlumot yoʻq)', { firmName });

  // Dedupe against the «iz» — never send a client twice. The count-batch walks the UNSENT set, so a
  // repeat send picks up the next N («narigilarni»), not the same N.
  const branchCode = firm.code ?? '';
  const sentSet = branchCode ? await getSentTalabnomaPinfls(opts.snapshotId, branchCode) : new Set<string>();
  const { remaining } = splitBySent(rows, sentSet);
  if (remaining.length === 0) return fail(mode, 'Barcha talabnomalar allaqachon joʻnatilgan', { firmName });

  // «Belgilangan son» — the first N of the UNSENT rows; the reyestr uploaded to hippo carries exactly N.
  let batch = remaining;
  if (opts.limit && opts.limit > 0 && opts.limit < batch.length) batch = batch.slice(0, opts.limit);

  let ctx;
  try {
    ctx = await resolveContext(session, 'talabnoma');
  } catch {
    return fail(mode, 'xat.hippo shabloni topilmadi', { firmName });
  }
  if (!ctx.organizationId || !ctx.branchId) {
    return fail(mode, 'xat.hippo konteksti topilmadi (shablon yoki filial ulanmagan)', { firmName });
  }

  let bal;
  try {
    bal = await checkBalanceFor(session, batch.length);
  } catch {
    return fail(mode, 'xat.hippo balansini olishda xatolik', { firmName });
  }
  const free = bal.pricePerMail === 0;
  // A REAL send is refused when the wallet can't cover it (a draft has no cost, so it's allowed).
  if (mode === 'send' && !bal.enough) {
    return fail(mode, `Balans yetarli emas: ${bal.required.toLocaleString('ru-RU')} soʻm kerak`, {
      firmName, balance: bal.balance, required: bal.required, enough: false, free,
    });
  }

  const mails = talabnomaRowsToMails(batch, ctx.templateName);
  let res;
  try {
    res = await createRegistryInternal(session, {
      organizationId: ctx.organizationId,
      branchId: ctx.branchId,
      autoSend: mode === 'send',
      mails,
    });
  } catch {
    return fail(mode, 'xat.hippo ga yuborishda xatolik', { firmName, balance: bal.balance, required: bal.required, enough: bal.enough, free });
  }
  // hippo can return HTTP 200 with a FAILURE envelope ({code>=400,...}) — login.ts guards the same way.
  // Without this, a rejected reyestr (e.g. «Invalid targeting setup.») would be recorded as SENT.
  const bodyCode = res.json && typeof res.json === 'object' ? Number((res.json as any).code) : NaN;
  const bodyErr = Number.isFinite(bodyCode) && bodyCode >= 400;
  if (!res.ok || bodyErr) {
    const msg = typeof res.json === 'string' ? res.json : res.json?.message ?? res.json?.error;
    return fail(mode, `xat.hippo rad etdi (${res.status}${bodyErr ? `/code ${bodyCode}` : ''})${msg ? `: ${String(msg).slice(0, 160)}` : ''}`, {
      firmName, balance: bal.balance, required: bal.required, enough: bal.enough, free,
    });
  }

  // Log the raw hippo response so its exact shape (registry id / any error) is visible in the server log.
  console.log('[hippo send] process-mails ok=%s status=%s json=%s', res.ok, res.status, (() => { try { return JSON.stringify(res.json)?.slice(0, 800); } catch { return String(res.json); } })());
  let registryId: string | number | null =
    res.json?.id ?? res.json?.data?.id ?? res.json?.registryId ?? res.json?.data?.registryId
    ?? res.json?.registry?.id ?? res.json?.registryId ?? (Array.isArray(res.json) ? (res.json[0]?.registryId ?? res.json[0]?.id) : null) ?? null;
  // If the create response carried no id, confirm the reyestr was formed by reading the newest one.
  if (registryId == null) {
    try {
      const list = await listRegistries(session, { PageIndex: 1, PageSize: 1 });
      const arr: any[] = Array.isArray(list.json) ? list.json : list.json?.data?.items ?? list.json?.items ?? list.json?.data ?? [];
      registryId = arr?.[0]?.id ?? null;
      console.log('[hippo send] newest registry after create id=%s', registryId);
    } catch (e) { console.error('[hippo send] listRegistries fallback failed', e); }
  }

  // Leave the «iz» so the next batch skips these clients. Non-fatal: a trace-write hiccup must not
  // fail a send that already landed on hippo.
  if (branchCode) {
    try {
      await recordSentTalabnomas(batch, {
        snapshotId: opts.snapshotId, branchCode,
        registryId: registryId != null ? String(registryId) : '',
        status: mode === 'send' ? 'SENT' : 'DRAFT',
      });
    } catch (e) { console.error('recordSentTalabnomas failed', e); }
  }
  return {
    ok: true, mode, count: batch.length,
    balance: bal.balance, required: bal.required, enough: bal.enough, free,
    registryId, firmName, remaining: Math.max(0, remaining.length - batch.length),
  };
  } finally {
    inFlightSends.delete(lockKey);
  }
}
