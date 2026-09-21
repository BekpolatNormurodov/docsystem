// Firma-bo'yicha, batafsil DETAIL+SUDYA yig'ish. cabinet.sud.uz'ni ketma-ket 8-9s pace bilan
// so'raymiz — parallellik portalni blokka olib keladi (2026-09-06 xotira). Har case uchun
// ikki so'rov: (1) get-one-case-by-id — javobgar PINFL, manzil, pasport; (2) histories —
// sudya (case_responsible_judge_full_name) + sud nomi. Ikkalasi ham yo'q bo'lsa dushmanchilik
// yo'q — natija «Kutilmoqda»da yozib qo'yiladi.
//
//   npx tsx scripts/spiska-load-detail.ts              # 4 firma ketma-ket
//   npx tsx scripts/spiska-load-detail.ts 12842        # bir firma
//   npx tsx scripts/spiska-load-detail.ts 12842 200    # limit
import { prisma } from '../src/lib/db';
import { FIRMS } from '../src/lib/firms';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';

const GAP_MS = Number(process.env.CABINET_DETAIL_GAP_MS) || 8_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toDate = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };
const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);

const CATS = ['civil', 'economic', 'administrative', 'conflict'] as const;
const LISTS = ['first-materials', 'first-non-material-cases', 'all-cases'] as const;

interface Task { caseNumber: string; caseId: string; needsDetail: boolean; needsJudge: boolean }

async function listAllCabinetCases(session: any) {
  const cases: { caseId: string; caseNumber: string }[] = [];
  const seen = new Set<string>();
  for (const cat of CATS) for (const list of LISTS) {
    try {
      const r = await cabinetFetch(session, `/api/cabinet/case/${cat}/${list}`);
      if (r.status !== 200) continue;
      for (const c of asArray(r.json)) {
        const key = c.case_number ?? c.case_id ?? c.claim_id;
        if (!key || seen.has(key) || !c.case_id) continue;
        seen.add(key);
        cases.push({ caseId: String(c.case_id), caseNumber: String(key) });
      }
      await sleep(500);
    } catch { /* skip */ }
  }
  return cases;
}

function realCaseIdFromDetail(detail: any): string | null {
  const parts = detail?.participants;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) { const id = p?.participant?.case_id; if (id) return String(id); }
  return null;
}

async function processFirm(firm: { branchCode: string; stir: string; name: string }, limit?: number) {
  console.log(`\n=== ${firm.name} (${firm.branchCode}) ===`);
  const session = await getStoredCabinetSession(firm.stir.replace(/\D+/g, ''));

  // 1) portaldan aynan qaysi ishlar borligini olamiz (case_id kerak — biz saqlab qo'yamiz)
  console.log('  ro‘yxatni olyapman...');
  const cases = await listAllCabinetCases(session);
  console.log(`  portalda ${cases.length} ta ish topildi`);

  // 2) bizdagi holatlarni chaqiramiz — qaysilariga nima kerakligini aniqlash uchun
  const stored = await prisma.clientCaseStatus.findMany({
    where: { source: 'CABINET', branchCode: firm.branchCode, caseNumber: { in: cases.map((c) => c.caseNumber) } },
    select: { caseNumber: true, matchedBy: true, judge: true, detail: true, status: true },
  });
  const byNum = new Map(stored.map((r) => [r.caseNumber, r]));

  // Sudya so'rovi FAQAT sudya tayinlangan bosqichlarda ma'noli — CREATED/REGISTER ishlari uchun
  // history bo'sh (sudya hali biriktirilmagan). Buni portalga tegmasdan skip qilamiz.
  const JUDGE_STATUSES = new Set(['ALLOCATE', 'PENDING', 'IN_PROCESS', 'DECIDED', 'FINISHED', 'DECLINED', 'RETURNED']);

  const tasks: Task[] = [];
  for (const c of cases) {
    const s = byNum.get(c.caseNumber);
    // Faqat bizning DB'da mavjud yozuvlar ustida ishlaymiz — aks holda updateMany hech narsani
    // yozmaydi va so'rov behuda ketadi (masalan portalda 5880, DB'da 700 — 5180 ta bekor).
    if (!s) continue;
    const detail: any = s.detail;
    const needsDetail = s.matchedBy !== 'PINFL' || !detail;
    const needsJudge = !s.judge && !!s.status && JUDGE_STATUSES.has(s.status);
    if (needsDetail || needsJudge) tasks.push({ caseNumber: c.caseNumber, caseId: c.caseId, needsDetail, needsJudge });
  }
  if (limit && tasks.length > limit) tasks.length = limit;
  console.log(`  ishlanadi: ${tasks.length} (detail: ${tasks.filter((t) => t.needsDetail).length}, sudya: ${tasks.filter((t) => t.needsJudge).length})`);
  console.log(`  ETA: ~${Math.round((tasks.length * (GAP_MS + 500) * 1.6) / 60000)} daq (har ish ~${(GAP_MS + 500) / 1000}s × 1-2 endpoint)`);

  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });

  let done = 0, gotPinfl = 0, gotJudge = 0, failed = 0;
  const t0 = Date.now();
  for (const t of tasks) {
    try {
      let realCaseId = t.caseId;
      // ---- DETAIL ----
      if (t.needsDetail) {
        const r = await cabinetFetch(session, `/api/cabinet/case/get-one-case-by-id/${t.caseId}`);
        const d: any = r.json ?? {};
        if (d?.participants) {
          const defs = (d.participants || []).filter((p: any) => p?.participant?.type === 'DEFENDANT');
          const main = defs.find((p: any) => p?.participant?.is_main) ?? defs[0];
          const pinfl = main?.entity?.pinfl ? String(main.entity.pinfl) : null;
          const det = main?.entity_details ?? {};
          const address = det.address ?? det.mailing_address ?? null;
          const passport = det.passport_serial || det.passport_number ? `${det.passport_serial ?? ''}${det.passport_number ?? ''}` : null;
          let ourPinfl: string | null = null; let inPortfolio = false;
          if (pinfl && snap) {
            const loan = await prisma.loan.findFirst({ where: { snapshotId: snap.id, branchCode: firm.branchCode, pinfl }, select: { pinfl: true } });
            inPortfolio = !!loan; ourPinfl = loan?.pinfl ?? pinfl;
          }
          if (pinfl) gotPinfl++;
          await prisma.clientCaseStatus.updateMany({
            where: { source: 'CABINET', branchCode: firm.branchCode, caseNumber: t.caseNumber },
            data: {
              pinfl: ourPinfl ?? pinfl ?? undefined,
              matchedBy: pinfl ? (inPortfolio ? 'PINFL' : 'UNMATCHED') : undefined,
              defAddress: address, defPassport: passport,
              registryDt: toDate(d.registry_dt), hearingDate: toDate(d.hearing_date),
              detail: d as any,
            },
          });
          realCaseId = realCaseIdFromDetail(d) ?? realCaseId;
        }
        await sleep(GAP_MS);
      }
      // ---- SUDYA + SUD ----
      if (t.needsJudge) {
        let judge: string | null = null; let court: string | null = null;
        try {
          const h = await cabinetFetch(session, `/api/cabinet/case/conflict-suit-view/histories/${realCaseId}`);
          const hi = asArray(h.json)[0];
          if (hi?.case_responsible_judge_full_name) judge = hi.case_responsible_judge_full_name;
          court = hi?.case_court?.names?.uz ?? hi?.case_court?.names?.uz_cyr ?? null;
        } catch { /* skip */ }
        if (!judge) {
          try {
            const a = await cabinetFetch(session, `/api/cabinet/case/appealable-documents/${realCaseId}`);
            const docs = asArray(a.json);
            const jd = docs.find((d) => d?.document_group === 'JUDGE') ?? docs[0];
            if (jd?.owner_name) judge = jd.owner_name;
          } catch { /* skip */ }
        }
        if (judge || court) {
          gotJudge++;
          await prisma.clientCaseStatus.updateMany({
            where: { source: 'CABINET', branchCode: firm.branchCode, caseNumber: t.caseNumber },
            data: { judge: judge ?? undefined, ...(court ? { detail: { ...(byNum.get(t.caseNumber)?.detail as object ?? {}), courtNameUz: court } as any } : {}) },
          });
        }
        await sleep(GAP_MS);
      }
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 100);
      if (failed <= 3) console.log(`  ! ${t.caseNumber}: ${msg}`);
    }
    done++;
    if (done % 20 === 0 || done === tasks.length) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const rate = done / (elapsed || 1);
      const eta = Math.round((tasks.length - done) / (rate || 0.1));
      console.log(`  [${firm.branchCode}] ${done}/${tasks.length} · +${gotPinfl} PINFL · +${gotJudge} sudya · ${failed} xato · ${elapsed}s · ETA ${Math.round(eta / 60)} daq`);
    }
  }

  console.log(`  yakun: ${done} ta, +${gotPinfl} PINFL, +${gotJudge} sudya, ${failed} xato`);
  return { done, gotPinfl, gotJudge, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyCode = args.find((a) => /^\d{4,6}$/.test(a));
  const limit = args.map(Number).find((n) => n && n > 0 && n < 1_000_000);
  const firms = onlyCode ? FIRMS.filter((f) => f.branchCode === onlyCode) : FIRMS;
  const serial = process.env.LOAD_DETAIL_SERIAL === '1';
  if (!firms.length) { console.error('Firma topilmadi'); process.exit(1); }

  const t0 = Date.now();
  if (serial || firms.length === 1) {
    // Ketma-ket rejim (bir IP, bir stream)
    for (const f of firms) {
      try { await processFirm({ branchCode: f.branchCode, stir: f.stir, name: f.name }, limit); }
      catch (e) { console.error(`✗ ${f.branchCode}:`, (e as Error).message); }
    }
  } else {
    // PARALLEL: har firma o'z sessiyasi/tokeni bilan bir vaqtda ishlaydi. Har oqim ichida GAP_MS
    // saqlanadi — 4 firma × 8s gap = ~0.5 req/s aggregat, 2026-09-06 dagi «6 parallel bitta firma»
    // burst'iga hech qanday yaqinlashmaydi. Baribir portal blokka olib borsa, LOAD_DETAIL_SERIAL=1
    // bilan ketma-ketga tushiring.
    console.log(`\n[parallel] ${firms.length} firma bir vaqtda (har birida ${GAP_MS}ms gap)`);
    await Promise.all(firms.map(async (f) => {
      try { await processFirm({ branchCode: f.branchCode, stir: f.stir, name: f.name }, limit); }
      catch (e) { console.error(`✗ ${f.branchCode}:`, (e as Error).message); }
    }));
  }
  const min = Math.round((Date.now() - t0) / 60000);
  console.log(`\n=== HAMMASI ${min} daqiqada tugadi ===`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('✗', e instanceof Error ? e.stack || e.message : e); process.exit(1); });
