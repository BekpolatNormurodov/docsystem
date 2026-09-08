// Enrich cabinet cases with their full detail (get-one-case-by-id): the detail
// exposes the defendant PINFL (hidden in list views), enabling EXACT pinfl
// linking + address/passport/judge. Updates ClientCaseStatus in place.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { cabinetFetch } from './api';
import type { CabinetSession } from './oneid';

const CATS = ['civil', 'economic', 'administrative', 'conflict'] as const;
const LISTS = ['first-materials', 'first-non-material-cases', 'all-cases'] as const;
const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);
const toDate = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Firma bo'yicha aylanma oyna boshlanish nuqtasi (pastdagi izohga qarang). */
const detailCursor = new Map<string, number>();

// cabinetapi.sud.uz rate-limits/blocks aggressively on bursty traffic (2026-09-06:
// a concurrency-6 detail-fetch pool over a firm's full case list is believed to have
// tripped a multi-hour connection block affecting the whole *.sud.uz domain). Fetch
// one case at a time with a fixed pacing delay between requests instead of a pool.
//
// 60 SONIYA JUDA SEKIN EDI. 2026-09-08: portalda 3 173 ta ish bor, ya'ni to'liq o'tish
// ~53 soat. Shu sabab aniq (PINFL) moslik BITTA HAM yig'ilmagan edi va sudga yuborish
// to'sig'i ishlamasdi. Blokni tezlik emas, PARALLELLIK keltirib chiqargan: bir vaqtda 6 ta
// so'rov. Ketma-ket so'rov esa allaqachon isbotlangan — sudga yuborish dvigateli har
// kuni soatlab 4 soniyada bittadan so'rov yuboradi va hech qachon bloklanmagan.
// Shuning uchun 8 soniya: dvigateldan IKKI BAROBAR sekinroq, lekin 3 173 ta ishni
// ~7 soatda emas, kerakli qismini ~1 soatda o'tadi.
const DETAIL_FETCH_INTERVAL_MS = Number(process.env.CABINET_DETAIL_GAP_MS) || 8_000;

export interface DetailResult { total: number; fetched: number; withPinfl: number; failed: number }

export async function ingestCabinetDetails(
  session: CabinetSession, branchCode: string,
  opts: {
    /** Shu partiyada eng ko'pi shuncha ish olinadi (worker sikli uchun). */
    limit?: number;
    /** Allaqachon aniq bog'langan yoki detali olingan ishlarni qayta so'ramaslik. */
    onlyUnresolved?: boolean;
  } = {},
): Promise<DetailResult> {
  // re-pull the list to get case_id (the detail key) alongside our stored caseNumber
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
        cases.push({ caseId: c.case_id, caseNumber: String(key) });
      }
    } catch { /* one flaky list endpoint must not abort the whole ingest */ }
  }

  // FAQAT HAL QILINMAGANLARNI olamiz.
  //
  // Har siklda 3 173 ta ishning detalini qayta so'rash — portalga behuda yuk va bizga
  // hech narsa bermaydi: aniq bog'langan ish o'zgarmaydi. Shuning uchun `matchedBy`
  // allaqachon 'PINFL' bo'lganlari va detali olinganlari o'tkazib yuboriladi.
  let pending = cases;
  if (opts.onlyUnresolved) {
    const resolved = await prisma.clientCaseStatus.findMany({
      where: {
        source: 'CABINET', branchCode,
        caseNumber: { in: cases.map((c) => c.caseNumber) },
        OR: [{ matchedBy: 'PINFL' }, { detail: { not: Prisma.DbNull } }],
      },
      select: { caseNumber: true },
    });
    const done = new Set(resolved.map((r) => r.caseNumber));
    pending = cases.filter((c) => !done.has(c.caseNumber));
  }
  // XAVFLILARI BIRINCHI.
  //
  // Detal so'rovi qimmat (8 soniyada bittadan), portalda esa 3 000 dan ortiq ish bor —
  // tartibsiz o'tilsa kerakli javob bir kunda kelardi. Holbuki ANIQ moslik faqat bitta
  // narsa uchun shoshilinch: bizning navbatimizda YUBORISHGA TAYYOR turgan odamga
  // portalda allaqachon da'vo bor-yo'qligini bilish. Aks holda avtomatika unga ikkinchi
  // da'vo ochadi (2026-09-08: shunday 391 ta ish bor edi).
  //
  // Shuning uchun avval ism bo'yicha TAXMIN qilingan PINFL bizda hali yuborilmagan
  // ish bilan mos tushganlari olinadi — ular ~400 ta, ya'ni bir necha soatda tugaydi.
  let riskyCaseNumbers = new Set<string>();
  if (pending.length > 1) {
    const guesses = await prisma.clientCaseStatus.findMany({
      where: { source: 'CABINET', branchCode, caseNumber: { in: pending.map((c) => c.caseNumber) }, pinfl: { not: null } },
      select: { caseNumber: true, pinfl: true },
    });
    const pinflByCase = new Map<string, string>();
    for (const g of guesses) if (g.caseNumber && g.pinfl) pinflByCase.set(g.caseNumber, g.pinfl);
    const risky = new Set<string>();
    const allPinfls = [...new Set([...pinflByCase.values()])];
    if (allPinfls.length) {
      const open = await prisma.arizaCase.findMany({
        where: {
          pinfl: { in: allPinfls }, kod: branchCode, courtCaseId: null,
          stage: { notIn: ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'] },
        },
        select: { pinfl: true },
      });
      const openPinfls = new Set(open.map((o) => o.pinfl).filter(Boolean) as string[]);
      for (const [num, pf] of pinflByCase) if (pf && openPinfls.has(pf)) risky.add(num);
    }
    riskyCaseNumbers = risky;
  }

  // OYNA AYLANADI — doimiy xato beruvchi ishlar qolganini bloklamaydi.
  //
  // Ilgari har siklda AYNAN birinchi `limit` ta olinardi. Detali kelmagan ish (o'chirilgan
  // ish, portal 5xx, javobgarda PINFL yo'q) hech narsa YOZMAYDI, ya'ni «hal qilinmagan»
  // bo'lib qolaveradi — va keyingi siklda yana birinchi bo'lib tanlanadi. Natijada
  // birinchi 40 ta doimiy xato butun ro'yxatni to'sib qo'yishi mumkin edi: sikl har
  // 20 daqiqada ishlaganday ko'rinar, aniq PINFL to'plami esa bo'sh qolardi — u esa
  // AYNAN ikkinchi da'vodan himoya qiladigan ro'yxat.
  //
  // TARTIB MUHIM: avval oynani suramiz, KEYIN xavflilarni oldinga chiqaramiz. Teskarisi
  // qilinsa aylanish xavfli-birinchi tartibini buzardi.
  if (opts.limit && pending.length > opts.limit) {
    const start = (detailCursor.get(branchCode) ?? 0) % pending.length;
    pending = [...pending.slice(start), ...pending.slice(0, start)];
    detailCursor.set(branchCode, start + opts.limit);
  }

  // XAVFLILAR BIRINCHI: PINFL'i bizda hali yuborilmagan ishga to'g'ri keladigan portal
  // yozuvlari. Ular aniqlanmasa avtomatika o'sha odamga ikkinchi da'vo ochishi mumkin,
  // shuning uchun oynaning qayerida bo'lishidan qat'i nazar oldinga olinadi.
  if (riskyCaseNumbers.size) {
    pending = [
      ...pending.filter((c) => riskyCaseNumbers.has(c.caseNumber)),
      ...pending.filter((c) => !riskyCaseNumbers.has(c.caseNumber)),
    ];
  }
  if (opts.limit && pending.length > opts.limit) pending = pending.slice(0, opts.limit);

  const res: DetailResult = { total: pending.length, fetched: 0, withPinfl: 0, failed: 0 };
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' } });

  for (let idx = 0; idx < pending.length; idx++) {
    const c = pending[idx];
    try {
      const r = await cabinetFetch(session, `/api/cabinet/case/get-one-case-by-id/${c.caseId}`);
      const d: any = r.json ?? {};
      if (!d || !d.participants) { res.failed++; }
      else {
        res.fetched++;

        const defs = (d.participants || []).filter((p: any) => p?.participant?.type === 'DEFENDANT');
        const main = defs.find((p: any) => p?.participant?.is_main) ?? defs[0];
        const pinfl = main?.entity?.pinfl ? String(main.entity.pinfl) : null;
        const det = main?.entity_details ?? {};
        const address = det.address ?? det.mailing_address ?? null;
        const passport = det.passport_serial || det.passport_number ? `${det.passport_serial ?? ''}${det.passport_number ?? ''}` : null;
        // link exactly to our portfolio client by that pinfl (confirm it's ours)
        let ourPinfl: string | null = null;
        let inPortfolio = false;
        if (pinfl && snap) {
          const loan = await prisma.loan.findFirst({ where: { snapshotId: snap.id, branchCode, pinfl }, select: { pinfl: true } });
          inPortfolio = !!loan;
          ourPinfl = loan?.pinfl ?? pinfl; // keep the real defendant pinfl even if not in portfolio
        }
        if (pinfl) res.withPinfl++;

        await prisma.clientCaseStatus.updateMany({
          // `branchCode` SHART: sud ish raqami akkauntlar bo'ylab yagona emas, ya'ni
          // usiz bitta firmaning detali BOSHQA firmaning yozuvini ustiga yozib yuboradi
          // (javobgar PINFL'i, manzili, sudyasi bilan birga). Yuqoridagi «hal qilinganlar»
          // so'rovi allaqachon branchCode bilan cheklangan edi — yozuv esa emas.
          where: { source: 'CABINET', branchCode, caseNumber: c.caseNumber },
          data: {
            pinfl: ourPinfl ?? pinfl ?? undefined,
            // Claim a confirmed PINFL match ONLY when the defendant is actually in OUR
            // portfolio — a raw cabinet pinfl not among our clients is UNMATCHED, not a match.
            matchedBy: pinfl ? (inPortfolio ? 'PINFL' : 'UNMATCHED') : undefined,
            defAddress: address, defPassport: passport,
            judge: d.chairman ?? d.responsible_judge ?? null,
            registryDt: toDate(d.registry_dt), hearingDate: toDate(d.hearing_date),
            detail: d as any,
          },
        });
      }
    } catch { res.failed++; }
    if (idx < pending.length - 1) await sleep(DETAIL_FETCH_INTERVAL_MS);
  }

  return res;
}
