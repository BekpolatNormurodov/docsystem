import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredCabinetSession } from '@/lib/cabinet/session';
import { getCaseDocuments, getAppealableDocuments } from '@/lib/cabinet/api';

export const runtime = 'nodejs';
export const maxDuration = 60;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const RANK: Record<string, number> = { FINISHED: 7, DECIDED: 6, IN_PROCESS: 5, RETURNED: 4, DECLINED: 4, PENDING: 2, CREATED: 1, DRAFT: 0 };

// One cabinet document → the lean shape the UI needs. The downloadable file is `pdf.id` (docx.id is
// usually null for signed judge acts). document_type_names carries the Uzbek label.
const mapDoc = (d: any) => ({
  id: d?.id ?? null,
  group: d?.document_group ?? null,          // JUDGE = ajrim/qaror; PARTICIPANT/ORG = ariza/ilova
  label: d?.document_type_names?.uz || d?.document_type_names?.uz_cyr || d?.document_type_names?.ru || 'Hujjat',
  signed: !!d?.is_signed,
  instance: d?.instance ?? null,
  fileId: d?.pdf?.id ?? d?.docx?.id ?? null, // download via /konveyer/court-doc-download
});

// GET ?caseId= — the cabinet.sud.uz documents for a client's court case: the judge acts (ajrim/qaror,
// incl. «qanoatlantirilgan») + all case documents. Downloadable in-app via court-doc-download. Read-only.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { pinfl: true, kod: true } });
  if (!ac?.pinfl) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  // Most-advanced cabinet case for this client → the cabinet case_id GUID (from the detail participants).
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
    select: { status: true, detail: true },
  });
  const best = rows.slice().sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0))[0];
  const cabinetCaseId = (best?.detail as any)?.participants?.[0]?.participant?.case_id ?? (best?.detail as any)?.id ?? null;
  if (!cabinetCaseId) return NextResponse.json({ found: false });

  const firm = ac.kod ? await prisma.firm.findUnique({ where: { code: ac.kod }, select: { stir: true } }) : null;
  if (!firm?.stir) return NextResponse.json({ error: 'Firma STIR yoʻq' }, { status: 422 });

  let session;
  try { session = await getStoredCabinetSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma cabinet.sud.uz ga ulanmagan' }, { status: 409 }); }

  try {
    const [appeal, all] = await Promise.all([
      getAppealableDocuments(session, cabinetCaseId).catch(() => ({ json: [] })),
      getCaseDocuments(session, cabinetCaseId).catch(() => ({ json: [] })),
    ]);
    const arr = (j: any): any[] => (Array.isArray(j) ? j : j?.data ?? j?.content ?? []);
    const ajrimlar = arr(appeal.json).map(mapDoc).filter((d) => d.fileId);
    const docs = arr(all.json).map(mapDoc).filter((d) => d.fileId);
    return NextResponse.json({ found: true, cabinetCaseId, ajrimlar, docs });
  } catch (e) {
    console.error('court-docs failed', e);
    return NextResponse.json({ error: 'Hujjatlarni olib boʻlmadi' }, { status: 502 });
  }
}
