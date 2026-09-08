/**
 * QORALAMANI ADOLAT'DAN O'CHIRISH + holatini tozalash.
 *
 * NEGA KERAK: 8-modda imtiyozi tuzatilishidan OLDIN tayyorlangan qoralamalar ADOLAT'da
 * to'liq davlat boji («Тўланмаган») bilan turibdi. Ularni o'chirib, case'ning
 * meta.draftReadyAt / cabinetDraftId ni tozalasak — ish «Tayyor»ga qaytadi va keyingi
 * «Go»da 8-modda imtiyozi bilan (davlat boji 0) QAYTA tayyorlanadi.
 *
 * XAVFSIZ: qoralama HALI sud ishi EMAS (save-suit qilinmagan) — o'chirilsa hech qanday
 * da'vo bekor bo'lmaydi, portal wizard holati tozalanadi, xolos.
 *
 * ISHLATISH (worker konteynerida):
 *   # avval KO'RISH (hech nima o'chirmaydi):
 *   docker compose --env-file .env.production exec worker npx tsx scripts/cabinet-draft-delete.ts 1
 *   # HAQIQATAN o'chirish:
 *   docker compose --env-file .env.production exec worker npx tsx scripts/cabinet-draft-delete.ts 1 --yes
 *
 * Argument: firmId (default 1 = BRIGHT). `--yes` bo'lmasa faqat ro'yxat ko'rsatiladi.
 */
import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { deleteDraft } from '../src/lib/cabinet/api';

async function main() {
  const args = process.argv.slice(2);
  const firmId = Number(args.find((a) => /^\d+$/.test(a)) ?? '1');
  const execute = args.includes('--yes');

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { stir: true, shortName: true } });
  if (!firm) throw new Error(`Firma topilmadi: ${firmId}`);
  const stir = (firm.stir || '').replace(/\D/g, '');
  if (!stir) throw new Error(`Firmada STIR yo'q: ${firm.shortName}`);

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(meta,'$.cabinetDraftId')) draftId, clientName
     FROM ArizaCase WHERE firmId=${firmId} AND JSON_EXTRACT(meta,'$.draftReadyAt') IS NOT NULL`,
  )) as Array<{ id: number; draftId: string | null; clientName: string | null }>;

  console.log(`\n${firm.shortName}: ${rows.length} ta tayyor qoralama (meta.draftReadyAt) topildi.\n`);
  for (const r of rows) console.log(`  case ${r.id}  draft=${r.draftId ?? '—'}  ${r.clientName ?? ''}`);

  if (!rows.length) { await prisma.$disconnect(); return; }
  if (!execute) {
    console.log(`\n⚠ Bu faqat KO'RISH. Haqiqatan o'chirish uchun oxiriga --yes qo'shing.\n`);
    await prisma.$disconnect();
    return;
  }

  const sess = await getStoredCabinetSession(stir);
  console.log(`\nADOLAT'dan o'chirilmoqda...\n`);
  const okIds: number[] = [];
  for (const r of rows) {
    if (!r.draftId) { console.log(`  SKIP case ${r.id} — cabinetDraftId yo'q`); continue; }
    try {
      const res = (await deleteDraft(sess, r.draftId)) as { ok?: boolean; status?: number };
      const ok = res?.ok === true || res?.status === 200 || res?.status === 204;
      console.log(`  ${ok ? 'DELETED' : `FAIL(${res?.status})`}  case ${r.id}  ${r.clientName?.slice(0, 30) ?? ''}`);
      if (ok) okIds.push(r.id);
    } catch (e) {
      console.log(`  ERR case ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (okIds.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE ArizaCase SET meta = JSON_REMOVE(meta,'$.draftReadyAt','$.cabinetDraftId') WHERE id IN (${okIds.join(',')})`,
    );
    const del = await prisma.courtQueueItem.deleteMany({ where: { caseId: { in: okIds } } });
    console.log(`\n✔ ${okIds.length} ta ADOLAT qoralamasi o'chirildi, meta tozalandi, ${del.count} ta navbat yozuvi o'chirildi.`);
    console.log(`  Endi bu ishlar «Tayyor»ga qaytdi — «Go» yoqilsa 8-modda imtiyozi bilan qayta tayyorlanadi.\n`);
  } else {
    console.log(`\nHech nima o'chirilmadi.\n`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1); });
