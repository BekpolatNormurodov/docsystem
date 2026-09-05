// Authenticated cabinet.sud.uz API client. All calls send the session token as
// X-AUTH-TOKEN (tokenPatternName from the bundle). base = cabinetapi.sud.uz.
import { CABINET, ENDPOINTS, SEND_TO_COURT_PREFIX } from './config';
import type { CabinetSession } from './oneid';

const TIMEOUT_MS = 30_000;

// cabinetapi.sud.uz is reachable from the production HOST reliably, but only intermittently
// from the web/worker containers' bridge network (same public IP, different NAT egress path —
// diagnosed 2026-09-05: host 10/10 connects, container mostly ECONNREFUSED/timeout). When
// CABINET_PROXY_URL is set (docker-compose wires it to the host-network `cabinet-proxy` sidecar,
// see docker/cabinet-proxy/), tunnel every cabinet request through it via HTTP CONNECT so it rides
// the host's reliable egress instead of the container's. Falls back to a direct fetch when unset
// (local dev, or the proxy sidecar not deployed) — same behavior as before this existed.
let dispatcher: unknown;
export function proxyDispatcher(): unknown {
  const proxyUrl = process.env.CABINET_PROXY_URL;
  if (!proxyUrl) return undefined;
  if (!dispatcher) {
    // Lazy + lazily-imported: undici is only needed when the proxy is actually configured.
    const { ProxyAgent } = require('undici') as typeof import('undici');
    dispatcher = new ProxyAgent(proxyUrl);
  }
  return dispatcher;
}

// fetch with a hard timeout — a hung gov endpoint must not stall a pool worker
// forever (which would deadlock the whole ingest). An abort surfaces as a throw
// the callers already treat as a failed request.
async function fetchT(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const disp = proxyDispatcher();
  try { return await fetch(url, { ...init, signal: ctrl.signal, ...(disp ? { dispatcher: disp } : {}) } as RequestInit); }
  finally { clearTimeout(t); }
}

export async function cabinetFetch(session: CabinetSession, path: string, init: RequestInit = {}) {
  // ⛔ Hard guard: the final submit (PUT /api/cabinet/case/send-to-court/{id}) is
  // irreversible — refuse to ever call it from code.
  if (path.startsWith(SEND_TO_COURT_PREFIX) || /\/case\/send-to-court\//i.test(path))
    throw new Error('BLOCKED: send-to-court is the irreversible final submit — refusing to call it.');
  const res = await fetchT(`${CABINET.base_url}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'X-AUTH-TOKEN': session.token,
      'ngrok-skip-browser-warning': 'true',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

const jget = (s: CabinetSession, p: string) => cabinetFetch(s, p);
const jpost = (s: CabinetSession, p: string, body: unknown) =>
  cabinetFetch(s, p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- case documents (ajrim/qaror + all case files) ----
// getCaseDocumentsByCaseId / getAppealableCaseDocumentsByCaseId — reverse-engineered from the
// cabinet.sud.uz «cases» chunk (2026-08). appealable-documents = the JUDGE documents (ajrim/qaror);
// case-documents = every document. Each doc carries `docx:{id,name}` — the downloadable file id.
export const getCaseDocuments = (s: CabinetSession, cabinetCaseId: string) => jget(s, `/api/cabinet/case/case-documents/${cabinetCaseId}`);
export const getAppealableDocuments = (s: CabinetSession, cabinetCaseId: string) => jget(s, `/api/cabinet/case/appealable-documents/${cabinetCaseId}`);

// Download a case file (PDF) by its file id → Buffer. `downloadFileById` in the bundle. The endpoint
// wraps the PDF as JSON `{ data: base64(...) }` with a small binary header before `%PDF-` — so we
// base64-decode and slice from the `%PDF-` marker to get a clean PDF. (Confirmed live 2026-08.)
export async function downloadCaseFile(session: CabinetSession, fileId: string): Promise<{ ok: boolean; status: number; buf: Buffer; contentType: string }> {
  const res = await fetchT(`${CABINET.base_url}/api/cabinet/case/download_as_buffer/${fileId}`, {
    headers: { 'X-AUTH-TOKEN': session.token, accept: '*/*', 'ngrok-skip-browser-warning': 'true' },
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let buf = raw;
  if (raw[0] === 0x7b /* '{' → JSON envelope */) {
    try {
      const j = JSON.parse(raw.toString('utf8'));
      const b64 = typeof j === 'string' ? j : (j?.data ?? j?.file ?? j?.content ?? '');
      if (b64) { const dec = Buffer.from(b64, 'base64'); const i = dec.indexOf('%PDF-'); buf = i >= 0 ? dec.subarray(i) : dec; }
    } catch { /* not JSON — keep raw */ }
  }
  return { ok: res.ok, status: res.status, buf, contentType: 'application/pdf' };
}

// ---- read-only ----
export const getUser = (s: CabinetSession) => jget(s, ENDPOINTS.userGet);
export const getCategories = (s: CabinetSession) => jget(s, ENDPOINTS.guideCategories);
export const getDocumentTypes = (s: CabinetSession) => jget(s, ENDPOINTS.guideDocumentTypes);
export const getDutyReasons = (s: CabinetSession) => jget(s, ENDPOINTS.dutyReasons);
export const getMinimumWages = (s: CabinetSession) => jget(s, ENDPOINTS.minimumWages);
export const listDrafts = (s: CabinetSession) => jget(s, ENDPOINTS.draftList);
export const getConflictCases = (s: CabinetSession) => jget(s, ENDPOINTS.conflictCases);
export const getSuit = (s: CabinetSession, id: string) => jget(s, ENDPOINTS.suitView + id);

// ---- draft (mutations; safe — a draft is not a court submission) ----
export const createDraft = (s: CabinetSession, body: unknown) => jpost(s, ENDPOINTS.draftCreate, body);
export const updateDraft = (s: CabinetSession, id: string, body: unknown) =>
  cabinetFetch(s, ENDPOINTS.draftUpdate + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Soft delete: PUT /pub-user-draft-cases/delete/{id}
export const deleteDraft = (s: CabinetSession, id: string) =>
  cabinetFetch(s, `/api/cabinet/pub-user-draft-cases/delete/${id}`, { method: 'PUT' });
// Bulk delete by ids
export const deleteDrafts = (s: CabinetSession, ids: string[]) => jpost(s, ENDPOINTS.draftDeleteByIds, { ids });

// ---- state fee (davlat boji) + invoice ----
export const calcDuties = (s: CabinetSession, params: Record<string, any>) =>
  jpost(s, ENDPOINTS.calcDuties, { ...params, withVCC: true });
export const generateInvoices = (s: CabinetSession, body: unknown) => jpost(s, ENDPOINTS.generateInvoices, body);
export const findByReceiptNumber = (s: CabinetSession, receiptNumber: string) =>
  jget(s, `${ENDPOINTS.findByReceiptNumber}?receiptNumber=${encodeURIComponent(receiptNumber)}`);

// ---- file upload: FormData(file) + file_type GUID (per document slot) ----
export async function uploadFile(session: CabinetSession, file: Blob | Buffer, fileType: string, fileName?: string) {
  const fd = new FormData();
  const blob = file instanceof Blob ? file : new Blob([new Uint8Array(file as Buffer)], { type: 'application/pdf' });
  fd.set('file', blob, fileName);
  const res = await fetchT(`${CABINET.base_url}${ENDPOINTS.fileUpload}`, {
    method: 'POST',
    headers: { 'X-AUTH-TOKEN': session.token, file_type: fileType },
    body: fd as any,
  });
  const text = await res.text();
  let json: any; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}
