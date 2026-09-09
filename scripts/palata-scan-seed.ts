/**
 * SEED: eski `data/palata-scan.json` (global fayl) → yangi `PalataScan` jadvali (snapshot bo'yicha).
 *
 * NEGA: skanlar DB'ga + snapshot bo'yicha bo'lishga ko'chirildi (sanalar aralashmasin). Bu skript
 * fayl-dunyoда yuklangan skanlarni ENG OXIRGI snapshotга bir marta ko'chiradi. Idempotent (upsert),
 * qayta ishga tushirish xavfsiz.
 *
 * ISHLATISH (worker konteynerida, `prisma db push` dan KEYIN):
 *   docker compose --env-file .env.production exec worker npx tsx scripts/palata-scan-seed.ts        # DRY-RUN
 *   docker compose --env-file .env.production exec worker npx tsx scripts/palata-scan-seed.ts --yes  # yozadi
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';

const DATA_PATH = path.join(process.cwd(), 'data', 'palata-scan.json');

async function main() {
  const execute = process.argv.includes('--yes');
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true, reportDate: true } });
  if (!snap) throw new Error('snapshot topilmadi');

  let rows: any[] = [];
  try { rows = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { rows = []; }
  const valid = rows.filter((r) => r && r.pinfl);
  const date = snap.reportDate.toISOString().slice(0, 10);
  console.log(`palata-scan.json: ${rows.length} yozuv (${valid.length} PINFL bilan) → snapshot ${snap.id} (${date})`);
  const before = await prisma.palataScan.count({ where: { snapshotId: snap.id } });
  console.log(`DB'da hozir shu snapshotда: ${before} ta PalataScan`);

  if (!execute) { console.log('\n⚠ DRY-RUN. Yozish uchun --yes qo\'shing.\n'); await prisma.$disconnect(); return; }

  let added = 0, err = 0;
  for (const r of valid) {
    const pinfl = String(r.pinfl);
    const body = {
      reg: String(r.reg ?? ''), pages: String(r.pages ?? ''), name: String(r.name ?? ''),
      firmKey: String(r.firmKey ?? ''), address: r.address ?? null, source: r.source ?? null,
    };
    try {
      await prisma.palataScan.upsert({
        where: { snapshotId_pinfl: { snapshotId: snap.id, pinfl } },
        create: { snapshotId: snap.id, pinfl, ...body },
        update: body,
      });
      added++;
    } catch { err++; }
  }
  const after = await prisma.palataScan.count({ where: { snapshotId: snap.id } });
  console.log(`\n✔ ${added} yozuv upsert qilindi (${err} xato). DB'da endi: ${after} ta.\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1); });
