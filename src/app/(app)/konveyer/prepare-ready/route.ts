import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { konveyerSnapshots } from '@/lib/konveyer';
import { enqueueJob } from '@/lib/job-dispatch';
import { selectReadyCaseIds, validateSelectedCaseIds, FIRM_REQUIRED_DOCS, FIRM_DOC_LABEL } from '@/lib/court-ready';
import { allocateFirmCases, consumeCourtSend, firmCourtBudgets } from '@/lib/court-routing';
import { isQueuePaused } from '@/lib/cabinet/pacer';

export const runtime = 'nodejs';

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
};

// POST { firmId, snapshotId?, limit?, includeExported?, talabnomaPdf? } —
// «Sudga chiqarish»: build the FULL ready packet (talabnoma+ariza+skan-slot+oferta
// +boji, NO grafik) for up to `limit` (max 100) fully-ready, not-yet-exported cases
// of ONE firm, into one ZIP, and stamp them exported. Returns { jobId, total }.
export async function POST(req: NextRequest) {
  // Match the read routes + the /sud page guard — the side-effectful export must
  // not be reachable by a user who has no 'sud' step grant.
  await requireStep('sud');
  const body = await req.json().catch(() => ({}));

  const firmId = num(body?.firmId);
  if (!firmId) return NextResponse.json({ error: 'firmId kerak (har firma alohida chiqariladi)' }, { status: 400 });

  // Firma hujjatlari (guvohnoma/ishonchnoma/shartnoma) TO'LIQ bo'lmasa — sudga yubormaymiz
  // (paket chala ketmasin). UI ham bloklaydi; bu — chetlab o'tishga qarshi server himoyasi.
  const haveDocs = new Set((await prisma.firmDocument.findMany({ where: { firmId }, select: { kind: true } })).map((d) => String(d.kind)));
  const missDocs = FIRM_REQUIRED_DOCS.filter((k) => !haveDocs.has(k));
  if (missDocs.length) return NextResponse.json({ error: `Firma hujjatlari yetishmaydi: ${missDocs.map((k) => FIRM_DOC_LABEL[k] ?? k).join(', ')}. Firmalar → «Hujjatlar»dan yuklang.` }, { status: 400 });
  // Resolve snapshot like the GET routes (validate against real snapshots, else latest)
  // so a missing/invalid snapshotId never runs downstream queries with NO snapshot filter.
  const snaps = await konveyerSnapshots();
  const rawSnap = num(body?.snapshotId);
  const snapshotId = rawSnap && snaps.some((s) => s.id === rawSnap) ? rawSnap : snaps[0]?.id;
  const limit = Math.min(100, Math.max(1, num(body?.limit) ?? 100));
  const includeExported = body?.includeExported === true;
  const talabnomaPdf = body?.talabnomaPdf !== false;

  // Optional hand-picked subset from the drill-down (server RE-VALIDATES every id —
  // a stale client selection can never smuggle a non-ready case into the ZIP);
  // otherwise auto-pick the oldest-due ready-and-not-exported cases.
  // Distinct, capped selection (Prisma `in` collapses duplicates, so dedupe first
  // to keep the `skipped` count honest).
  const uniqIds = Array.isArray(body?.caseIds)
    ? [...new Set((body.caseIds as unknown[]).map(Number).filter((x): x is number => Number.isInteger(x) && x > 0))].slice(0, 100)
    : null;
  const caseIds = uniqIds?.length
    ? await validateSelectedCaseIds({ snapshotId, firmId, caseIds: uniqIds, includeExported })
    : await selectReadyCaseIds({ snapshotId, firmId, limit, includeExported });
  if (caseIds.length === 0) {
    return NextResponse.json(
      { error: includeExported ? 'Chiqarish uchun tayyor mijoz yoʻq' : 'Yuborishga tayyor (chiqarilmagan) mijoz yoʻq' },
      { status: 400 },
    );
  }
  const skipped = uniqIds ? uniqIds.length - caseIds.length : 0;

  // ── Sud yo'naltirish + kunlik limit ─────────────────────────────────────────────────────────
  // Firmaning sud(lar)i bo'yicha taqsimlaymiz: har sud kunlik limiti/cutoff/ish-kuni bilan.
  // Limitdan oshgani BUGUN yuborilmaydi (keyingi ish kuniga suriladi). Konfiguratsiya bo'lmasa
  // (Court jadvali bo'sh) — alloc=null, hech narsa cheklanmaydi (eski xatti-harakat).
  // Operator modalda sudlarni tanlagan bo'lsa — faqat o'shalarga yuboriladi. Boshqa sudga
  // ALLAQACHON biriktirilgan ish tanlangan sudga KO'CHIRILMAYDI, chetga suriladi
  // (allocateFirmCases ichida): arizada bir sud, da'voda boshqa sud bo'lib qolmasin.
  const courtIds = Array.isArray(body?.courtIds)
    ? [...new Set((body.courtIds as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0))]
    : undefined;

  let sendIds = caseIds;
  let deferred = 0;
  const alloc = await allocateFirmCases(firmId, caseIds, new Date(), courtIds);
  if (alloc) {
    sendIds = alloc.assignments.map((a) => a.caseId);
    deferred = alloc.deferred.length;
    if (sendIds.length === 0) {
      // Bugun hech nima ketmaydi — sababini tushuntiramiz (yopiq oyna yoki limit tugagan).
      const budgets = await firmCourtBudgets(firmId);
      const parts = budgets.map((b) => {
        const w = b.window.reason === 'weekend' ? 'ish kuni emas'
          : b.window.reason === 'past-cutoff' ? 'vaqt tugagan'
          : b.window.reason === 'inactive' ? 'o‘chirilgan'
          : `${b.remaining}/${b.court.dailyQuota} qoldi`;
        return `${b.court.shortName}: ${w}`;
      });
      const courtNote = courtIds?.length ? ' (faqat tanlangan sud(lar) hisobga olindi)' : '';
      return NextResponse.json(
        { error: `Bugun sudga yuborib bo‘lmaydi (keyingi ish kuniga suriladi)${courtNote}. ${parts.join(' · ')}` },
        { status: 400 },
      );
    }
    // Limitni darhol iste'mol qilamiz (count-at-write) — courtId + courtSentAt yoziladi.
    await consumeCourtSend(alloc.assignments);
  }

  // Saytdan sudga yuborishda real topshirish dvigateli (COURT_SUBMIT) ishlaydi.
  // Agar exportOnly: true berilsa, faqat ZIP fayl tayyorlash (PACKET) bajariladi.
  const isExportOnly = body?.exportOnly === true;
  const jobType = isExportOnly ? 'PACKET' : 'COURT_SUBMIT';

  // Umumiy pauza YANGI partiyani ham to'sadi (faqat ketayotganini emas). ZIP tayyorlash
  // portalga tegmaydi — u pauzadan qat'i nazar ishlayveradi.
  if (!isExportOnly && (await isQueuePaused())) {
    return NextResponse.json(
      { error: 'Sudga yuborish jarayoni pauzada. Davom ettirish uchun «Davom ettirish» tugmasini bosing.' },
      { status: 409 },
    );
  }

  const job = await prisma.job.create({
    data: {
      type: jobType,
      status: 'PENDING',
      snapshotId: snapshotId ?? null,
      total: sendIds.length,
      params: { firmId, snapshotId, caseIds: sendIds, ready: true, talabnomaPdf, includeGrafik: false, markExported: true },
    },
  });

  // Run inline (default) or leave PENDING for the Docker worker (JOB_MODE=worker).
  enqueueJob(job.id);

  // `skipped`/`deferred` additive — existing callers read only jobId/total.
  // `type` — UI uchun: PACKET tugagach ZIP havolasi ko'rsatiladi, COURT_SUBMIT tugagach esa
  // yakuniy hisobot matni (ZIP yo'q — bu job fayl yaratmaydi, havola 404 berardi).
  return NextResponse.json({ jobId: job.id, type: jobType, total: sendIds.length, skipped, deferred });
}
