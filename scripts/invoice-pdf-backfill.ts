// scripts/invoice-pdf-backfill.ts
//
// billing.sud.uz'da YARATILGAN, lekin PDF'i yuklab olinmagan kvitansiyalarni to'ldiradi.
//
// NEGA KERAK: invoice yaratishda PDF yuklash «ixtiyoriy» deb belgilangan va xatosi jimgina
// yutilgan (invoice-rest.ts:471 / :594 — `catch { /* raqam saqlanadi, PDF ixtiyoriy */ }`).
// Natijada 2026-09-07 holatiga: 3228 ta InvoiceRecord bor, hammasi status=CREATED, lekin
// pdfPath HAMMASIDA bo'sh va diskda atigi 2 ta PDF yotibdi. Sudga yuborishda kvitansiya
// PDF'i biriktirilishi kerak (ADOLAT hujjat turi: «Почта харажати тўланганлиги тўғрисида
// маълумотнома»), shuning uchun bu bo'shliq to'ldirilmasa hujjat hech qachon ketmaydi.
//
// TEZLIK: bugungi saboq — burst so'rovlar *.sud.uz'ni soatlab bloklaydi. Shuning uchun
// so'rovlar KETMA-KET va oralig'ida kutish bilan ketadi. Standart 2s; --delay bilan o'zgartiring.
//
//   npx tsx scripts/invoice-pdf-backfill.ts            # hammasi, 2s oraliq
//   npx tsx scripts/invoice-pdf-backfill.ts --limit 50 # faqat 50 ta (sinov uchun)
//   npx tsx scripts/invoice-pdf-backfill.ts --delay 5  # oraliqni 5s qilish
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { downloadInvoicePdf } from '../src/lib/invoice-rest';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = Number(arg('--limit') ?? 0) || undefined;
  const delayMs = (Number(arg('--delay') ?? 2) || 2) * 1000;

  // `invoiceNo` majburiy (String @unique) — `not: null` sharti Prisma'da xato beradi.
  const rows = await prisma.invoiceRecord.findMany({
    where: { pdfPath: null },
    select: { id: true, invoiceNo: true },
    orderBy: { id: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`PDF'i yo'q kvitansiyalar: ${rows.length} ta · oraliq ${delayMs / 1000}s`);
  if (!rows.length) return;
  console.log(`Taxminiy davomiylik: ~${Math.ceil((rows.length * delayMs) / 60000)} daqiqa\n`);

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const no = String(r.invoiceNo);
    const pos = `[${i + 1}/${rows.length}]`;

    // Fayl allaqachon diskda bo'lsa — qayta yuklamaymiz, faqat bazani bog'laymiz.
    const rel = path.join('storage', 'invoices', `${no}.pdf`);
    if (fs.existsSync(path.join(process.cwd(), rel))) {
      await prisma.invoiceRecord.update({ where: { id: r.id }, data: { pdfPath: rel } });
      skip++;
      console.log(`${pos} ${no} — diskda bor, bog'landi`);
      continue;
    }

    try {
      const saved = await downloadInvoicePdf(no);
      await prisma.invoiceRecord.update({ where: { id: r.id }, data: { pdfPath: saved } });
      ok++;
      console.log(`${pos} ${no} — ✔ yuklandi`);
    } catch (e) {
      fail++;
      console.error(`${pos} ${no} — ✗ ${e instanceof Error ? e.message : e}`);
    }

    if (i < rows.length - 1) await sleep(delayMs);
  }

  console.log(`\nYakun: ${ok} yuklandi, ${skip} allaqachon bor edi, ${fail} xato`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('Fatal:', e instanceof Error ? e.message : e); process.exit(1); });
