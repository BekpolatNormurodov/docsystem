import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireStep } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { listSendableSuits, sendGate, activeCourtJob, createSendSuitsJob } from '@/lib/court-send-suits';
import { audit, AuditAction } from '@/lib/audit';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';

// «SUDGA O'TKAZISH» (/sud 3-tab, 2026-09-19). ADOLAT'da allaqachon saqlangan suit'larni (stop-B,
// «Murojaatlarim»da CREATED) firma E-IMZO tasdig'idan keyin tizim o'zi send-to-court qiladi.
// Real yuborishning YAGONA yo'li — eski «prepare-ready draftMode'siz» va real navbat avto-davomi
// o'chirilgan. Mantiq to'liq src/lib/court-send-suits.ts da; bu yerda faqat HTTP qatlami.

const num = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

// GET ?firmId=&s= — ro'yxat (DB bo'yicha yaroqlilik + to'siqlar), darvoza holati (env, pauza,
// attestatsiya) va ayni paytdagi sud partiyasi. Snapshot: ?s= → cookie → eng oxirgisi (court-ready bilan bir xil).
export async function GET(req: NextRequest) {
  const user = await requireStep('sud:send');
  const snaps = await konveyerSnapshots();
  const raw = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = num(raw);
  const snapshotId = parsed && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const firmId = num(req.nextUrl.searchParams.get('firmId'));

  const [gate, list, activeJob] = await Promise.all([
    sendGate({ userId: user.id }),
    listSendableSuits({ firmId, snapshotId }),
    activeCourtJob(),
  ]);
  return NextResponse.json({ snapshotId: snapshotId ?? null, gate, rows: list.rows, counts: list.counts, activeJob });
}

// POST { firmId, caseIds } — tanlangan suit'larni sudga o'tkazish partiyasi. Server HAMMA shartni
// qayta tekshiradi (UI ro'yxati eskirgan bo'lishi mumkin): env, pauza, attestatsiya, faol partiya,
// har ish yaroqliligi, sud limiti. Rad etilganlar sababi bilan qaytadi.
export async function POST(req: NextRequest) {
  const user = await requireStep('sud:send');
  const t = getT();
  const body = await req.json().catch(() => ({}));
  const res = await createSendSuitsJob({ firmId: Number(body?.firmId), caseIds: body?.caseIds, userId: user.id }, t);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.rejected ? { rejected: res.rejected } : {}), ...(res.excluded ? { excluded: res.excluded } : {}) },
      { status: res.status },
    );
  }
  // Kim, qachon, qaysi firma, nechta — /jurnal'da ko'rinadi (so'rov kontekstida: aktyor = shu foydalanuvchi).
  await audit(AuditAction.COURT_SUBMIT, {
    target: `firm:${Number(body?.firmId)}`,
    detail: { amal: 'sudga o‘tkazish partiyasi yaratildi', jobId: res.jobId, soni: res.total, chetdaQoldi: res.excluded.length },
  });
  return NextResponse.json({ jobId: res.jobId, total: res.total, excluded: res.excluded });
}
