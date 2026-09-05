// Map debt-gated talabnoma rows → xat.hippo internal «mails» (the reyestr the template flow
// imports), WITHOUT going through an .xlsx round-trip. Produces the exact same content shape as
// `readInternalMailsFromExcel`: the SPECIAL columns (receiver/address/region/area) become the
// mail's own fields; every other template column goes into the JSON `content` blob hippo fills
// into the template. Values are stringified the same way the Excel importer normalizes them
// (dates → YYYY-MM-DD, numbers as plain strings) so a direct send and an Excel upload are
// byte-identical on hippo's side.
import { prisma } from '@/lib/db';
import { hippoTemplateIdByStir, hippoBranchIdByStir } from '@/lib/firms';
import { getStoredHippoSession } from './session';
import { loadTalabnomaRowsForScope } from './talabnoma-bulk';
import { resolveContext, checkBalanceFor, createRegistryInternal, createRegistryExternal, listRegistries, type InternalMail } from './xat';
import { getSentTalabnomaPinfls, splitBySent, recordSentTalabnomas } from './talabnoma-trace';
import type { TalabnomaRow } from './talabnoma-excel';

const pad = (x: number) => String(x).padStart(2, '0');
// LOCAL components — matches xat.normVal (toISOString() is UTC and can shift the day by one).
const ymd = (d: Date | null): string => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');

/**
 * Build one InternalMail per talabnoma row for `createRegistryInternal`.
 * `templateName` must be the hippo template name (resolved via `resolveContext`).
 * Rows are assumed already debt-gated (total_debt > 0) by loadTalabnomaRowsForScope.
 *
 * `idSuffix` (per-send nonce) is appended to the hippo clientCustomId so every send gets a FRESH id
 * — hippo's clientCustomId is unique-per-account, and `contract_id` (=`<date>/<seq>`) is positional,
 * so without a suffix a re-send collides and hippo answers «already exists». The suffix affects ONLY
 * the hippo dedup key; the human-readable `contract_id` inside `content` (the «№» on the talabnoma)
 * stays clean.
 */
export function talabnomaRowsToMails(rows: TalabnomaRow[], templateName: string, idSuffix?: string): InternalMail[] {
  const suffix = (idSuffix ?? '').trim();
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
    const base = String(r.contract_id ?? '').trim();
    const customId = base ? (suffix ? `${base}-${suffix}` : base) : '';
    const pinfl = String(r.pinfl ?? '').trim();
    return {
      receiver: r.receiver,
      regionId: r.region,
      areaId: r.area,
      address: r.address,
      content: JSON.stringify(content),
      templateName,
      custom_id: customId || null,
      ...(customId ? { clientCustomId: customId } : {}),
      ...(pinfl ? { PinflOrInn: pinfl } : {}), // required by the external flow (Bright); ignored by internal
    };
  });
}

// Short unique-per-send token (base36 time + random) for the hippo clientCustomId suffix.
export const sendNonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
  count: number;               // on hippo this batch = queued + duplicates
  queued?: number;             // newly accepted (navbatga qo'shildi)
  duplicates?: number;         // rejected as «already exists» — already sent before (not an error)
  failed?: number;             // rejected for a real reason (bad data) — stay «remaining»
  failedMessages?: string[];   // hippo's reason for the genuine failures (first few)
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

  // Pin this firm's own talabnoma template (Urban 119 / Bright 42 / Community 123). The shared
  // hippo account lists all three, so without the id the name match would send every firm on the
  // first «Talabnoma» it finds.
  const templateId = hippoTemplateIdByStir(firm.stir ?? '');
  const branchOverride = hippoBranchIdByStir(firm.stir ?? ''); // Bright: 56 (stale reyestr branch 12 o'rniga)
  let ctx;
  try {
    ctx = await resolveContext(session, 'talabnoma', templateId, branchOverride);
  } catch {
    return fail(mode, 'xat.hippo shabloni topilmadi', { firmName });
  }
  if (!ctx.organizationId || !ctx.branchId) {
    return fail(mode, 'xat.hippo konteksti topilmadi (shablon yoki filial ulanmagan)', { firmName });
  }
  console.log('[hippo send] firm=%s templateId=%s templateName=%s org=%s branch=%s',
    firmName, ctx.templateId, ctx.templateName, ctx.organizationId, ctx.branchId);

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

  // Fresh per-send id suffix so «doim ketsin» — hippo never rejects as a duplicate (user's choice).
  const mails = talabnomaRowsToMails(batch, ctx.templateName, sendNonce());
  // Log a sample of the OUTGOING request so a hippo-side rejection («Xatolar bilan yakunlandi») is
  // diagnosable — region/area/address/content are the usual culprits when every row errors.
  const sample = mails[0];
  console.log('[hippo send] req firm=%s template=%s org=%s branch=%s count=%d sample=%j',
    firmName, ctx.templateName, ctx.organizationId, ctx.branchId, mails.length,
    sample ? { receiver: sample.receiver, regionId: sample.regionId, areaId: sample.areaId, address: sample.address, content: sample.content } : null);
  // region/area = 0 → hippo processing REJECTS these («Xatolar bilan yakunlandi»). Surface exactly WHO
  // so the mapping gap is fixable, and so the count doesn't silently overstate what will land.
  const badGeo = mails.filter((m) => !m.regionId || !m.areaId);
  if (badGeo.length) console.warn('[hippo send] %d/%d rows have region/area=0 (hippo will reject): %j',
    badGeo.length, mails.length, badGeo.slice(0, 15).map((m) => ({ receiver: m.receiver, region: m.regionId, area: m.areaId, address: m.address })));
  const base = {
    organizationId: ctx.organizationId,
    templateId: ctx.templateId,     // pin the exact template (Bright has «Talabnoma » AND «Talabnoma 3»)
    templateName: ctx.templateName,
    autoSend: mode === 'send',
    mails,
  };
  // «Invalid targeting setup» has several possible causes across orgs: wrong/stale branch (Bright's
  // org shows branches:null → the reyestr branch 12 is stale), or the org uses the external (Pinfl)
  // flow. Try the sensible variants in order and keep the FIRST that succeeds. A firm that works
  // (Urban) succeeds on attempt 0, so nothing changes for it.
  const ok = (r: { ok: boolean; json: any }) => r.ok && !(r.json && typeof r.json === 'object' && Number((r.json as any).code) >= 400);
  // Tartib: avval IKKALA «+branch» (internal, external) — chunki «no-branch» varianti org branch
  // talab qilsa «Both OrganizationId and BranchId are mandatory» berib, external+branch'ni sinashga
  // yo'l qo'ymay to'xtatib qo'yardi (Bright: internal+branch «Invalid targeting», keyin noBranch
  // «mandatory» → external+branch UMUMAN sinalmasdi). Endi external+branch 2-navbatda.
  const attempts: { label: string; run: () => Promise<{ ok: boolean; status: number; json: any }> }[] = [
    { label: 'internal+branch', run: () => createRegistryInternal(session, { ...base, branchId: ctx.branchId }) },
    { label: 'external+branch', run: () => createRegistryExternal(session, { ...base, branchId: ctx.branchId }) },
    { label: 'internal-noBranch', run: () => createRegistryInternal(session, { ...base, branchId: null }) },
    { label: 'external-noBranch', run: () => createRegistryExternal(session, { ...base, branchId: null }) },
  ];
  let res: { ok: boolean; status: number; json: any } = { ok: false, status: 0, json: null };
  // Bir marta «Invalid targeting» ko'rilsa — bu firma org'i API'ga yopiq degani; keyingi «no-branch»
  // varianti «Both OrganizationId and BranchId are mandatory» berib, asl sababni yashiradi. Shuni eslab
  // qolamiz va oxirida foydalanuvchiga to'g'ri (Excel yo'li) ko'rsatmani beramiz.
  let sawInvalidTargeting = false;
  try {
    for (let i = 0; i < attempts.length; i++) {
      res = await attempts[i].run();
      if (ok(res)) { if (i > 0) console.warn('[hippo send] succeeded on variant «%s»', attempts[i].label); break; }
      const err = res.json && typeof res.json === 'object' ? String((res.json as any).error ?? (res.json as any).message ?? '') : String(res.json ?? '');
      if (/invalid targeting/i.test(err)) sawInvalidTargeting = true;
      // Targeting/branch config errors → keep trying the other variants; a genuinely different error
      // (balance, data validation) stops here. «...mandatory» = no-branch variant rad etdi — bu ham
      // targeting/config mismatch, shuning uchun external+branch'ga o'tishga to'sqinlik qilmasin.
      const targetingErr = /invalid targeting|mandatory|branch/i.test(err);
      if (!targetingErr) break;
      if (i < attempts.length - 1) console.warn('[hippo send] variant «%s» → «%s», trying next', attempts[i].label, err);
    }
  } catch {
    return fail(mode, 'xat.hippo ga yuborishda xatolik', { firmName, balance: bal.balance, required: bal.required, enough: bal.enough, free });
  }
  // hippo can return HTTP 200 with a FAILURE envelope ({code>=400,...}) — login.ts guards the same way.
  // Without this, a rejected reyestr (e.g. «Invalid targeting setup.») would be recorded as SENT.
  const bodyCode = res.json && typeof res.json === 'object' ? Number((res.json as any).code) : NaN;
  const bodyErr = Number.isFinite(bodyCode) && bodyCode >= 400;
  if (!res.ok || bodyErr) {
    // One-line reject diagnostic — the org/branch/template we targeted + the raw error body.
    console.error('[hippo send] REJECT firm=%s status=%s org=%s branch=%s tpl=%j count=%d resp=%s',
      firmName, res.status, ctx.organizationId, ctx.branchId, ctx.templateName, mails.length,
      (() => { try { return JSON.stringify(res.json)?.slice(0, 300); } catch { return String(res.json); } })());
    const msg = typeof res.json === 'string' ? res.json : res.json?.message ?? res.json?.error;
    // «Invalid targeting setup» = this firm's hippo org isn't enabled for API sending (both endpoints
    // rejected). Nothing the operator can fix in-app — point them at the Excel path that DOES work.
    const friendly = (sawInvalidTargeting || /invalid targeting/i.test(String(msg ?? '')))
      ? 'Bu firma xat.hippo’da API orqali yuborishga sozlanmagan (org «Invalid targeting»). «Reyestr (Excel)» tugmasi bilan yuklab olib, hippo saytiga o‘zingiz yuklang (yoki hippo’dan API’ni yoqishni so‘rang).'
      : `xat.hippo rad etdi (${res.status}${bodyErr ? `/code ${bodyCode}` : ''})${msg ? `: ${String(msg).slice(0, 160)}` : ''}`;
    return fail(mode, friendly, {
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

  // ── Outcome split (from hippo's create envelope) ─────────────────────────────────────────────
  // hippo returns { data: { queuedCount, errorCount, errorMessages:[ "ClientCustomId 'X' already
  // exists for this account." ] } }. A DUPLICATE is a client already on hippo — a re-send after the
  // «iz» was cleared; it IS sent, so it's still traced (only genuine bad-data errors stay «remaining»).
  // Match each rejected message back to its row by contract_id (= custom_id).
  const data: any = (res.json && typeof res.json === 'object' ? (res.json as any).data : null) ?? {};
  const errorMessages: string[] = Array.isArray(data.errorMessages) ? data.errorMessages.map(String) : [];
  const rejected = new Map<string, boolean>(); // custom_id → isDuplicate
  for (const m of errorMessages) {
    const id = /ClientCustomId '([^']+)'/i.exec(m)?.[1];
    if (id) rejected.set(id.trim(), /already exists/i.test(m));
  }
  const queued: TalabnomaRow[] = [];
  const duplicates: TalabnomaRow[] = [];
  const failed: TalabnomaRow[] = [];
  for (const r of batch) {
    const cid = String(r.contract_id ?? '').trim();
    if (cid && rejected.has(cid)) (rejected.get(cid) ? duplicates : failed).push(r);
    else queued.push(r);
  }
  console.log('[hippo send] outcome reyestr=%s queued=%d duplicates=%d failed=%d', registryId, queued.length, duplicates.length, failed.length);

  // Trace the ones that are ON hippo (queued now + duplicates from before). Non-fatal: a trace-write
  // hiccup must not fail a send that already landed. Genuine failures are NOT traced → stay «remaining».
  const traced = [...queued, ...duplicates];
  if (branchCode && traced.length) {
    try {
      await recordSentTalabnomas(traced, {
        snapshotId: opts.snapshotId, branchCode,
        registryId: registryId != null ? String(registryId) : '',
        status: mode === 'send' ? 'SENT' : 'DRAFT',
      });
    } catch (e) { console.error('recordSentTalabnomas failed', e); }
  }
  return {
    ok: true, mode, count: traced.length,
    queued: queued.length, duplicates: duplicates.length, failed: failed.length,
    failedMessages: failed.length ? errorMessages.filter((m) => !/already exists/i.test(m)).slice(0, 5) : [],
    balance: bal.balance, required: bal.required, enough: bal.enough, free,
    registryId, firmName, remaining: Math.max(0, remaining.length - traced.length),
  };
  } finally {
    inFlightSends.delete(lockKey);
  }
}
