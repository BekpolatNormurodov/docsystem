import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

const RANK: Record<string, number> = { FINISHED: 7, DECIDED: 6, IN_PROCESS: 5, RETURNED: 4, DECLINED: 4, PENDING: 2, CREATED: 1, DRAFT: 0 };

// GET ?caseId= — the court (cabinet.sud.uz) detail for a case's client: status/ruling, judge,
// hearing date, result, article (modda) + executor (ijrochi) probed from the detail JSON. Read-only.
export async function GET(req: NextRequest) {
  await requireUser();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  const ac = await prisma.arizaCase.findUnique({ where: { id: caseId }, select: { pinfl: true, kod: true, snapshotId: true, courtCaseId: true } });
  if (!ac?.pinfl) return NextResponse.json({ error: 'Case maʼlumoti yoʻq' }, { status: 404 });

  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
    select: {
      status: true, statusLabel: true, caseResult: true, caseNumber: true, claimId: true, claimKind: true,
      instance: true, courtId: true, judge: true, hearingDate: true, registryDt: true, defAddress: true, detail: true,
    },
  });
  if (rows.length === 0) return NextResponse.json({ found: false, courtCaseId: ac.courtCaseId ?? null });

  // Most-advanced cabinet case for this client.
  const best = rows.slice().sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0))[0];
  const detail = best.detail as any;

  return NextResponse.json({
    found: true,
    caseNumber: best.caseNumber ?? ac.courtCaseId ?? null,
    status: best.status,
    statusLabel: best.statusLabel,
    result: best.caseResult,                                   // ish natijasi (RETURNED | FULFILLED | …)
    definitionDate: (detail as any)?.definition_date ?? null,  // ajrim sanasi — qaytarilgan bo'lsa qaytarish sanasi
    ruled: best.status === 'DECIDED' || best.status === 'FINISHED',
    claimKind: best.claimKind,                                 // DECREE | SUIT | MATERIAL
    instance: best.instance,
    judge: best.judge,                                         // sudya
    hearingDate: best.hearingDate,                             // majlis sanasi
    registryDt: best.registryDt,
    defAddress: best.defAddress,
    registryNumber: (detail as any)?.registry_number ?? null,   // sud reyestr raqami (detailda bor)
    // Confirmed by inspecting 50 real cabinet details: modda/ijrochi/oylik are NOT in the
    // get-one-case-by-id payload (it carries case meta + participants + a category GUID only).
    modda: null,   // asl modda sud qaror hujjatida — cabinet ro'yxat detalida yo'q
    ijrochi: null, // davlat ijrochisi — MIB (ijro) API'sida, cabinet'da yo'q
    oylik: null,   // oylikka qaratish — MIB (ijro) API'sida
    caseCount: rows.length,
  });
}
