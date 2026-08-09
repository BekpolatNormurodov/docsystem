// Authenticated cabinet.sud.uz API client. All calls send the session token as
// X-AUTH-TOKEN (tokenPatternName from the bundle). base = cabinetapi.sud.uz.
import { CABINET, ENDPOINTS, SEND_TO_COURT_PREFIX } from './config';
import type { CabinetSession } from './oneid';

export async function cabinetFetch(session: CabinetSession, path: string, init: RequestInit = {}) {
  // ⛔ Hard guard: the final submit (PUT /api/cabinet/case/send-to-court/{id}) is
  // irreversible — refuse to ever call it from code.
  if (path.startsWith(SEND_TO_COURT_PREFIX) || /\/case\/send-to-court\//i.test(path))
    throw new Error('BLOCKED: send-to-court is the irreversible final submit — refusing to call it.');
  const res = await fetch(`${CABINET.base_url}${path}`, {
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
  const res = await fetch(`${CABINET.base_url}${ENDPOINTS.fileUpload}`, {
    method: 'POST',
    headers: { 'X-AUTH-TOKEN': session.token, file_type: fileType },
    body: fd as any,
  });
  const text = await res.text();
  let json: any; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}
