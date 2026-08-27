// xat.hippo.uz registry (reyestr) API — create / read / status / delete.
// Confirmed from the live frontend bundles (RegistryService-*.js,
// CreateRegistry-*.js), 2026-08. All calls use the bearer token from login.
import ExcelJS from 'exceljs';
import { HIPPO, hippoFetch, type HippoSession } from './login';

// ---- low-level helpers -------------------------------------------------

export async function api(session: HippoSession, path: string, init: RequestInit = {}, timeoutMs?: number) {
  const res = await hippoFetch(session, path, {
    ...init,
    headers: { 'ngrok-skip-browser-warning': 'true', accept: '*/*', ...(init.headers || {}) },
  }, timeoutMs);
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

const jget = (s: HippoSession, path: string) => api(s, path);
const jpost = (s: HippoSession, path: string, body: unknown) =>
  api(s, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const jdelete = (s: HippoSession, path: string, timeoutMs?: number) => api(s, path, { method: 'DELETE' }, timeoutMs);

// Binary GET (PDF/xlsx blobs) -> Buffer.
async function apiBlob(session: HippoSession, path: string): Promise<Buffer> {
  const res = await hippoFetch(session, path, { headers: { 'ngrok-skip-browser-warning': 'true' } });
  if (!res.ok) throw new Error(`blob ${res.status} @ ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- form-load / account endpoints ------------------------------------

export const getMe = (s: HippoSession) => jget(s, '/me');
// Wallet balance + active tariff. Response: { name, identifier, balance,
// creditAmount, allowCredit, effectiveTariff:{ basePrice, includedPages } }.
export const getBalance = (s: HippoSession) => jget(s, '/billing/my-balance');
export const getTemplates = (s: HippoSession) => jget(s, '/template');
export const getMyOrganizations = (s: HippoSession) => jget(s, '/my-organizations');
export const getMyBranches = (s: HippoSession) => jget(s, '/my-organization-branches');

// ---- registry CRUD -----------------------------------------------------

export const listRegistries = (s: HippoSession, params: Record<string, any> = {}) => {
  const qs = new URLSearchParams(params as any).toString();
  return jget(s, '/Registry' + (qs ? `?${qs}` : ''));
};
export const getRegistry = (s: HippoSession, id: string | number) => jget(s, `/Registry/${id}`);
// DELETE a reyestr. Two traps hippo sets: (1) it can answer HTTP 200 with a FAILURE envelope
// ({code>=400} / {success:false}) — so a naive res.ok check reports success while nothing is deleted;
// (2) some deploys route the resource lowercase. Try /Registry/{id}; on 404/405 retry /registry/{id};
// fold the envelope into `ok` so callers get the TRUE result (and the body for the real message).
export async function deleteRegistry(s: HippoSession, id: string | number) {
  // Shorter per-attempt ceiling than the 30s default — hippo's DELETE often stalls the RESPONSE even
  // when it deletes server-side; a 15s abort keeps the UI from spinning half a minute (the caller then
  // confirms by re-listing). ~404/405 → retry the lowercase route.
  const DEL_TIMEOUT = 15_000;
  let res = await jdelete(s, `/Registry/${id}`, DEL_TIMEOUT);
  if (!res.ok && (res.status === 404 || res.status === 405)) res = await jdelete(s, `/registry/${id}`, DEL_TIMEOUT);
  const j: any = res.json;
  const code = j && typeof j === 'object' ? Number(j.code) : NaN;
  const envelopeErr = (Number.isFinite(code) && code >= 400) || j?.success === false;
  return { ok: res.ok && !envelopeErr, status: res.status, json: res.json, envelopeErr };
}

// Is a registry still present in the firm's live list? Used to CONFIRM a delete whose HTTP response
// hung/aborted (hippo deletes server-side but stalls the reply) — if it's gone, the delete landed.
export async function registryExists(s: HippoSession, id: string | number): Promise<boolean> {
  const target = String(Number(id));
  const { json } = await listRegistries(s, { PageIndex: 1, PageSize: 100 });
  const arr: any[] = Array.isArray(json) ? json : json?.data?.items ?? json?.items ?? json?.data ?? [];
  return arr.some((r) => String(Number(r?.id)) === target);
}

// Live registry ids (newest page) for trace reconciliation — the set the «iz» is checked against.
export async function liveRegistryIds(s: HippoSession, pageSize = 100): Promise<number[]> {
  const { json } = await listRegistries(s, { PageIndex: 1, PageSize: pageSize });
  const arr: any[] = Array.isArray(json) ? json : json?.data?.items ?? json?.items ?? json?.data ?? [];
  return arr.map((r) => Number(r?.id)).filter((n) => Number.isFinite(n) && n > 0);
}
export const getAutoSendStatus = (s: HippoSession, id: string | number) => jget(s, `/registry/${id}/auto-send-status`);
export const listRegistryMails = (s: HippoSession, registryId: string | number, pageIndex = 1, pageSize = 50) =>
  jget(s, `/mail/all?${new URLSearchParams({ RegistryId: String(registryId), PageIndex: String(pageIndex), PageSize: String(pageSize) })}`);

// ---- balance / affordability check -------------------------------------

export interface BalanceCheck {
  balance: number;          // current wallet balance (so'm)
  creditAmount: number;     // available credit
  allowCredit: boolean;
  basePrice: number;        // covers `includedPages` pages
  includedPages: number;
  extraPagePrice: number;   // per page beyond includedPages
  pagesPerMail: number;     // assumed pages per talabnoma
  pricePerMail: number;     // basePrice + max(0, pages-included) * extraPagePrice
  count: number;            // how many mails you intend to send
  required: number;         // pricePerMail * count
  spendable: number;        // balance + (allowCredit ? creditAmount : 0)
  enough: boolean;
  shortfall: number;        // how much more you need (0 if enough)
  maxAffordable: number;    // how many mails you CAN send now (Infinity if free)
}

// Fetch the live balance/tariff and compute whether `count` mails are
// affordable. Cost model (confirmed from the wallet UI): each mail costs
// basePrice for the first `includedPages` pages, plus extraPagePrice for each
// page beyond. BRIGHT's live tariff is currently all-zero (sending is free).
export async function checkBalanceFor(s: HippoSession, count: number, pagesPerMail = 1): Promise<BalanceCheck> {
  const { json } = await getBalance(s);
  const b = json?.data ?? json ?? {};
  const balance = Number(b.balance ?? 0);
  const creditAmount = Number(b.creditAmount ?? 0);
  const allowCredit = !!b.allowCredit;
  const basePrice = Number(b.effectiveTariff?.basePrice ?? 0);
  const includedPages = Number(b.effectiveTariff?.includedPages ?? 0);
  const extraPagePrice = Number(b.effectiveTariff?.extraPagePrice ?? 0);
  const pricePerMail = basePrice + Math.max(0, pagesPerMail - includedPages) * extraPagePrice;
  const required = pricePerMail * count;
  const spendable = balance + (allowCredit ? creditAmount : 0);
  const enough = spendable >= required;
  return {
    balance, creditAmount, allowCredit, basePrice, includedPages, extraPagePrice, pagesPerMail,
    pricePerMail, count, required, spendable, enough,
    shortfall: enough ? 0 : required - spendable,
    maxAffordable: pricePerMail > 0 ? Math.floor(spendable / pricePerMail) : Infinity,
  };
}

// ---- context resolution (org / branch / template) ---------------------

// The obvious /me, /my-balance, /my-organizations paths 404; the reliable
// sources are: template.organizationId, and an existing registry's branchId
// (the org requires a valid branch or the server returns "Invalid targeting
// setup."). templateNameHint is matched case-insensitively (note: the real
// name is "Talabnoma " with a trailing space).
export async function resolveContext(s: HippoSession, templateNameHint = 'talabnoma', templateId?: number) {
  const tpl = await getTemplates(s);
  const tplArr: any[] = Array.isArray(tpl.json) ? tpl.json : tpl.json?.data ?? tpl.json?.items ?? [];
  // Pin the EXACT template per firm when an id is given — the account's list holds several
  // «Talabnoma» entries (Urban 119 / Bright 42 / Community 123) so a name match alone is ambiguous
  // and would pick the first one for every firm. Fall back to the name hint when no id (or not found).
  const byId = templateId ? tplArr.find((x) => Number(x?.id) === Number(templateId)) : undefined;
  const t = byId ?? tplArr.find((x) => String(x?.name ?? '').toLowerCase().includes(templateNameHint.toLowerCase()));
  const templateName: string = t?.name ?? templateNameHint;
  const resolvedTemplateId = Number(t?.id ?? templateId ?? 0);
  let organizationId = Number(t?.organizationId ?? 0);

  const orgOf = (b: any) => Number(b?.organizationId ?? b?.orgId ?? b?.organization?.id ?? 0);
  // ALWAYS fetch the org's branches — not just as a fallback. The login can see MULTIPLE orgs, so the
  // newest registry's branch may belong to a DIFFERENT org → «Invalid targeting setup». We use this
  // list to validate the branch and, when it's wrong-org/missing, pick a branch under the template org.
  let branchesArr: any[] = [];
  try {
    const br = await getMyBranches(s);
    branchesArr = Array.isArray(br.json) ? br.json : br.json?.data?.items ?? br.json?.items ?? br.json?.data ?? [];
    console.log('[hippo ctx] getMyBranches=%s branches=%j', br.status,
      branchesArr.slice(0, 20).map((b) => ({ id: b?.id ?? b?.branchId, org: orgOf(b), name: b?.name ?? b?.shortName, def: b?.isDefault ?? b?.isMain ?? b?.default })));
  } catch (e) { console.error('[hippo ctx] getMyBranches failed', e); }

  // /my-organization-branches 404s here, so the only reliable branch source is an existing registry.
  // But the login sees MULTIPLE orgs — the newest registry may be another org's (branch 12) → «Invalid
  // targeting setup». So scan a page of registries and take the branchId of one that belongs to the
  // TEMPLATE's org. Log each registry's {id,org,branch} so the topology is visible.
  let branchId = 0;
  const list = await listRegistries(s, { PageIndex: 1, PageSize: 50 });
  const listArr: any[] = Array.isArray(list.json) ? list.json : list.json?.data?.items ?? list.json?.items ?? list.json?.data ?? [];
  const regOrg = (r: any) => Number(r?.organizationId ?? r?.organization?.id ?? r?.orgId ?? 0);
  console.log('[hippo ctx] registries=%d sample=%j raw0=%s', listArr.length,
    listArr.slice(0, 12).map((r) => ({ id: r?.id, org: regOrg(r), branch: Number(r?.branchId ?? 0), name: r?.name })),
    (() => { try { return JSON.stringify(listArr[0])?.slice(0, 350); } catch { return ''; } })());
  // Prefer a registry under the template's org; fall back to the newest if none carries an org field.
  const ref = (organizationId ? listArr.find((r) => regOrg(r) === organizationId) : null) ?? listArr[0];
  if (ref?.id) {
    branchId = Number(ref?.branchId ?? 0);
    if (!branchId) {
      const det = await getRegistry(s, ref.id);
      branchId = Number(det.json?.branchId ?? det.json?.data?.branchId ?? 0);
    }
  }
  if (!organizationId && ref) organizationId = regOrg(ref) || organizationId;
  void branchesArr; // (kept for the getMyBranches diagnostic log above)

  if (!organizationId) {
    try {
      const orgs = await getMyOrganizations(s);
      const arr: any[] = Array.isArray(orgs.json) ? orgs.json : orgs.json?.data?.items ?? orgs.json?.items ?? orgs.json?.data ?? [];
      organizationId = Number(arr?.[0]?.id ?? arr?.[0]?.organizationId ?? 0);
    } catch (e) { console.error('[hippo ctx] getMyOrganizations fallback failed', e); }
  }

  // /template status distinguishes an EXPIRED token (401 → reconnect) from an empty account (200).
  // Log the ids we see + the raw response so a shape mismatch vs a genuinely template-less account
  // (wrong org connected) is distinguishable.
  console.log('[hippo ctx] getTemplates=%s(ok=%s) templates=%d ids=%j org=%s branch=%s raw=%s',
    tpl.status, tpl.ok, tplArr.length, tplArr.slice(0, 12).map((x) => ({ id: x?.id, name: x?.name, org: x?.organizationId })),
    organizationId, branchId, (() => { try { return JSON.stringify(tpl.json)?.slice(0, 300); } catch { return String(tpl.json); } })());
  return { templateName, templateId: resolvedTemplateId, organizationId, branchId };
}

// ---- sent mails + kvitansiya (receipt) ---------------------------------

// GET /api/mails — sent-letter list (filters: RegistryId, PageIndex, PageSize…).
export const getSentMails = (s: HippoSession, params: Record<string, any> = {}) => {
  const qs = new URLSearchParams(params as any).toString();
  return jget(s, '/api/mails' + (qs ? `?${qs}` : ''));
};
export const getMail = (s: HippoSession, uid: string) => jget(s, `/api/mails/${uid}`);

// Letter PDF for one sent mail.
export const downloadMailPdf = (s: HippoSession, uid: string) => apiBlob(s, `/mail/${uid}/download`);
// Kvitansiya (delivery receipt) PDF — keyed by the mail UID (the Sent page's
// "Kvitansiya" button posts each selected mail's uid to /perform/receipt/{uid}).
export const downloadReceiptPdf = (s: HippoSession, uid: string) => apiBlob(s, `/perform/receipt/${uid}`);

// Collect the sent mails of a registry that should have a kvitansiya. Pages
// through /mail/all and keeps every sent (isSend) mail; performType records
// whether it's Delivered/etc. so callers can filter if they want.
export interface ReceiptRef { uid: string; receiverName?: string; sendStatus?: string; performType?: string; isSend?: boolean }
export async function listReceiptRefs(s: HippoSession, registryId: string | number, pageSize = 100): Promise<ReceiptRef[]> {
  const refs: ReceiptRef[] = [];
  for (let page = 1; ; page++) {
    const { json } = await listRegistryMails(s, registryId, page, pageSize);
    const items: any[] = Array.isArray(json) ? json : json?.data?.items ?? json?.items ?? json?.data ?? [];
    if (!items.length) break;
    for (const m of items) {
      if (!m.uid) continue;
      refs.push({ uid: m.uid, receiverName: m.receiverName, sendStatus: m.sendStatus, performType: m.activePerform?.performType, isSend: m.isSend });
    }
    if (items.length < pageSize) break;
  }
  return refs;
}

// ---- registry create (internal, template-based) ------------------------

export interface InternalMail {
  receiver: string;
  regionId: number;
  areaId: number;
  address: string;
  content: string;       // JSON.stringify of template-variable columns
  templateName: string;
  custom_id: string | null;
  clientCustomId?: string;
}

export interface CreateRegistryPayload {
  organizationId: number;
  branchId: number;
  autoSend: boolean;     // false = drafts only (safe); true = actually dispatch
  mails: InternalMail[];
}

// POST /registry/process-mails  (internal template flow — the "Reyestr yaratish" tab)
export const createRegistryInternal = (s: HippoSession, payload: CreateRegistryPayload) =>
  jpost(s, '/registry/process-mails', payload);

// POST /registry/process-mails/external  (Pinfl/Inn flow)
export const createRegistryExternal = (s: HippoSession, payload: CreateRegistryPayload) =>
  jpost(s, '/registry/process-mails/external', payload);

// ---- Excel -> internal mails (mirrors the frontend Iw builder) ---------

const isNum = (v: any) => v != null && v !== '' && !isNaN(Number(v));
// Vo(): light value normalize — dates -> YYYY-MM-DD, strip currency symbols.
const normVal = (v: any) => {
  // Format from LOCAL components — toISOString() is UTC and can shift the calendar
  // day by one for cells ExcelJS returns with a non-zero offset (wrong date on the talabnoma).
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const t = String(v ?? '');
  return /\d/.test(t) ? t.replace(/[$€£¥₽₩]/g, '').trim() : t;
};
const SPECIAL = new Set(['receiver', 'address', 'region', 'area', 'branch_id', 'customid', 'templatename']);

// Read a template Excel (row 1 = machine header, optional label row 2, data
// after). `rows` picks 1-based DATA row numbers relative to the first data row.
export async function readInternalMailsFromExcel(
  filePath: string,
  templateName: string,
  opts: { headerRow?: number; firstDataRow?: number; take?: number } = {},
): Promise<InternalMail[]> {
  const headerRow = opts.headerRow ?? 1;
  const firstDataRow = opts.firstDataRow ?? headerRow + 2; // skip machine header + human-label row
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const header: string[] = (ws.getRow(headerRow).values as any[]).map((v) => String(v ?? '').trim());

  const mails: InternalMail[] = [];
  const lastRow = opts.take ? firstDataRow + opts.take - 1 : ws.rowCount;
  for (let r = firstDataRow; r <= lastRow && r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values as any[];
    const row: Record<string, any> = {};
    for (let c = 1; c < header.length; c++) if (header[c]) row[header[c]] = vals[c];
    if (!String(row.receiver ?? '').trim()) continue; // z0(receiver)

    const content: Record<string, any> = {};
    for (const k of Object.keys(row)) if (!SPECIAL.has(k.toLowerCase())) content[k] = normVal(row[k]);
    const customId = String(row.customId ?? '').trim();
    mails.push({
      receiver: String(row.receiver ?? ''),
      regionId: isNum(row.region) ? Number(row.region) : 0,
      areaId: isNum(row.area) ? Number(row.area) : 0,
      address: String(row.address ?? ''),
      content: JSON.stringify(content),
      templateName,
      custom_id: customId || null,
      ...(customId ? { clientCustomId: customId } : {}),
    });
  }
  return mails;
}

export { HIPPO };
