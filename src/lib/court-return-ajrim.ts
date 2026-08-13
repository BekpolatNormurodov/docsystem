// Suddan qaytgan ish uchun AJRIM (sud JUDGE hujjati) — cabinet.sud.uz'dan LIVE olinadi:
// ajrim turi (masalan «Ажрим (аризани қайтариш)»), sudya, sud nomi va yuklab olinadigan
// ajrim PDF (aniq sabab shu hujjat MATNIDA yozilgan). Faqat o'qish — send-to-court BLOKlangan.
//
// Muhim: cabinet document/history endpoint'lari haqiqiy `case_id` ni talab qiladi — u
// ClientCaseStatus.claimId EMAS, balki saqlangan detail.participants[].participant.case_id ichida.
import { prisma } from './db';
import { getStoredCabinetSession } from './cabinet/session';
import { getAppealableDocuments, cabinetFetch, downloadCaseFile } from './cabinet/api';

const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);

function realCaseId(detail: any): string | null {
  const parts = detail?.participants;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) { const id = p?.participant?.case_id; if (id) return String(id); }
  return null;
}

// firm.code (branchCode) → cabinet session account. STIR is stored with spaces («311 976 765»);
// the session account is digits-only («311976765»).
async function sessionForBranch(branchCode: string) {
  const firm = await prisma.firm.findFirst({ where: { code: branchCode }, select: { stir: true } });
  const account = (firm?.stir ?? '').replace(/\D/g, '');
  if (!account) throw new Error('Firma STIR topilmadi');
  return getStoredCabinetSession(account); // throws SessionExpiredError if none active
}

async function resolve(caseNumber: string): Promise<{ session: Awaited<ReturnType<typeof getStoredCabinetSession>>; caseId: string } | null> {
  const row = await prisma.clientCaseStatus.findFirst({
    where: { source: 'CABINET', caseNumber },
    select: { branchCode: true, detail: true },
  });
  if (!row) return null;
  const caseId = realCaseId(row.detail);
  if (!caseId) return null;
  const session = await sessionForBranch(row.branchCode);
  return { session, caseId };
}

// Pick the judge (ajrim/qaror) document from the appealable list.
function pickJudgeDoc(json: unknown) {
  const docs = asArray(json);
  return docs.find((d) => d?.document_group === 'JUDGE') ?? docs[0] ?? null;
}

export interface ReturnAjrim {
  available: boolean;
  ajrimType: string | null;   // «Ажрим (аризани қайтариш)» — cabinet document type
  pdfName: string | null;
  judge: string | null;
  court: string | null;
  outgoingDate: string | null;
}

/** LIVE ajrim metadata for a returned case (ajrim type + judge + court). The exact reason
 *  text is inside the ajrim PDF — download via downloadReturnAjrim. */
export async function getReturnAjrim(caseNumber: string): Promise<ReturnAjrim> {
  const empty: ReturnAjrim = { available: false, ajrimType: null, pdfName: null, judge: null, court: null, outgoingDate: null };
  const r = await resolve(caseNumber);
  if (!r) return empty;
  const { session, caseId } = r;
  const a = await getAppealableDocuments(session, caseId);
  const jd = pickJudgeDoc(a.json);
  let court: string | null = null;
  let judge: string | null = jd?.owner_name ?? null;
  try {
    const h = await cabinetFetch(session, `/api/cabinet/case/conflict-suit-view/histories/${caseId}`);
    const hi = asArray(h.json)[0];
    court = hi?.case_court?.names?.uz ?? hi?.case_court?.names?.uz_cyr ?? null;
    if (hi?.case_responsible_judge_full_name) judge = hi.case_responsible_judge_full_name;
  } catch { /* history is a nice-to-have */ }
  return {
    available: !!(jd?.pdf?.id),
    ajrimType: jd?.document_type_names?.uz_cyr ?? jd?.document_type_names?.uz ?? null,
    pdfName: jd?.pdf?.name ?? null,
    judge,
    court,
    outgoingDate: jd?.outgoing_date ?? null,
  };
}

/** Stream-ready ajrim PDF (the ruling where the concrete return reason is written). */
export async function downloadReturnAjrim(caseNumber: string): Promise<{ buf: Buffer; name: string } | null> {
  const r = await resolve(caseNumber);
  if (!r) return null;
  const { session, caseId } = r;
  const a = await getAppealableDocuments(session, caseId);
  const jd = pickJudgeDoc(a.json);
  const pdfId = jd?.pdf?.id;
  if (!pdfId) return null;
  const dl = await downloadCaseFile(session, pdfId);
  if (!dl.ok) return null;
  const name = (jd?.pdf?.name ?? `ajrim-${caseNumber}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
  return { buf: dl.buf, name };
}
