/**
 * remove-court-cases.ts — «sud ro'yxatidan chiqarish»: har firma uchun berilgan Excel
 * (urban/bright/community «sud …».xlsx) dagi F.I.O bo'yicha mos ArizaCase'larni VA ularga
 * bog'liq hamma narsani (CaseDocument fayllari + yozuvlari, InvoiceRecord, palata-scan.json
 * dagi skan yozuvi) o'chiradi.
 *
 * Fayl ustunlari: №, Javobgar (F.I.O), Ish raqami, sanalar, Holat, Natija.  Mos qilish
 * F.I.O normalizatsiyasi bo'yicha (invoice-import bilan bir xil), HAR fayl O'Z firmasi
 * doirasida. Firma fayl nomidagi urban/bright/community so'zidan aniqlanadi.
 *
 * XAVFSIZ: standart DRY-RUN — hech nima o'chirmaydi, faqat nechta mos/mos-emas/takror
 * borligini ko'rsatadi. Haqiqatan o'chirish uchun `--apply`.  Avval `--apply` dан oldin
 * PROD backup oling (./scripts/backup.sh).
 *
 * Ishga tushirish (worker/konteyner ichida, DB tarmog'ida):
 *   node --import tsx scripts/remove-court-cases.ts --dir <xlsx papkasi>            # dry-run
 *   node --import tsx scripts/remove-court-cases.ts --dir <xlsx papkasi> --apply    # o'chirish
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db';

const normName = (s: string) => s.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
const DATA_PATH = path.join(process.cwd(), 'data', 'palata-scan.json');

// Fayl nomidagi kalit so'z → firma shortName ичидаги kalit.
const FIRM_KEYS: [RegExp, string][] = [
  [/urban/i, 'URBAN'], [/bright/i, 'BRIGHT'], [/communit/i, 'COMMUNITY'],
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes('--apply');

async function readNames(file: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const out: string[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(2).value; // «Javobgar» = 2-ustun
    const name = v == null ? '' : String(typeof v === 'object' && (v as { text?: string }).text ? (v as { text: string }).text : v).trim();
    if (name) out.push(name);
  }
  return out;
}

async function main() {
  const dir = arg('--dir') || path.join(process.cwd(), 'court-remove');
  const files = (await fs.readdir(dir)).filter((f) => /\.xlsx$/i.test(f) && /sud/i.test(f));
  if (files.length === 0) { console.error(`Papkada «sud …».xlsx topilmadi: ${dir}`); process.exit(1); }

  console.log(`Rejim: ${APPLY ? 'APPLY (o‘chiriladi!)' : 'DRY-RUN (o‘chirilmaydi)'}\nPapka: ${dir}\nFayllar: ${files.join(', ')}\n`);

  const allCaseIds = new Set<number>();
  const allPinfls = new Set<string>();

  for (const file of files) {
    const key = FIRM_KEYS.find(([re]) => re.test(file))?.[1];
    if (!key) { console.log(`⚠ ${file}: firma aniqlanmadi (urban/bright/community emas) — o‘tkazib yuborildi`); continue; }
    const firm = await prisma.firm.findFirst({ where: { shortName: { contains: key } } });
    if (!firm) { console.log(`⚠ ${file}: «${key}» firmasi bazada topilmadi — o‘tkazib yuborildi`); continue; }

    const names = await readNames(path.join(dir, file));
    const cases = await prisma.arizaCase.findMany({ where: { firmId: firm.id }, select: { id: true, pinfl: true, clientName: true } });
    const byName = new Map<string, { id: number; pinfl: string | null }[]>();
    for (const c of cases) {
      const k = normName(c.clientName || '');
      if (!k) continue;
      (byName.get(k) || byName.set(k, []).get(k)!).push({ id: c.id, pinfl: c.pinfl });
    }

    let matched = 0, ambiguous = 0; const notFound: string[] = [];
    for (const nm of names) {
      const hits = byName.get(normName(nm)) || [];
      if (hits.length === 0) { notFound.push(nm); continue; }
      if (hits.length > 1) ambiguous++;
      for (const h of hits) { allCaseIds.add(h.id); if (h.pinfl) allPinfls.add(h.pinfl); matched++; }
    }
    console.log(`▶ ${firm.shortName} (${file}): ${names.length} F.I.O → ${matched} case mos, ${notFound.length} topilmadi, ${ambiguous} bir xil ismli (hammasi olinadi)`);
    if (notFound.length) console.log(`   topilmaganlar (namuna): ${notFound.slice(0, 8).join(' | ')}${notFound.length > 8 ? ' …' : ''}`);
  }

  const ids = [...allCaseIds];
  console.log(`\nJAMI o‘chiriladigan case: ${ids.length}, skan yozuvi (pinfl): ${allPinfls.size}`);
  if (ids.length === 0) { await prisma.$disconnect(); return; }

  if (!APPLY) {
    console.log('\nDRY-RUN — hech nima o‘chirilmadi. Rozimisiz? Backup oling, so‘ng `--apply` bilan qayta ishga tushiring.');
    await prisma.$disconnect();
    return;
  }

  // 1) CaseDocument fayllarini diskdan o'chiramiz (yozuvlar cascade bilan ketadi).
  const docs = await prisma.caseDocument.findMany({ where: { caseId: { in: ids } }, select: { filePath: true } });
  let filesRemoved = 0;
  for (const d of docs) {
    if (!d.filePath) continue;
    const p = path.isAbsolute(d.filePath) ? d.filePath : path.join(process.cwd(), d.filePath);
    await fs.rm(p, { force: true }).then(() => { filesRemoved++; }).catch(() => {});
  }

  // 2) InvoiceRecord (caseId FK — cascade emas, qo'lda) → so'ng ArizaCase (CaseDocument cascade).
  const invDel = await prisma.invoiceRecord.deleteMany({ where: { caseId: { in: ids } } });
  const caseDel = await prisma.arizaCase.deleteMany({ where: { id: { in: ids } } });

  // 3) palata-scan.json dagi skan yozuvlarini (pinfl bo'yicha) olib tashlaymiz.
  let scanRemoved = 0;
  try {
    const cur: { pinfl?: string }[] = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
    const kept = cur.filter((x) => !(x.pinfl && allPinfls.has(x.pinfl)));
    scanRemoved = cur.length - kept.length;
    await fs.writeFile(DATA_PATH, JSON.stringify(kept, null, 1));
  } catch { /* fayl yo'q bo'lsa — skan yo'q */ }

  console.log(`\n✅ Bajarildi: ArizaCase o‘chdi=${caseDel.count}, InvoiceRecord=${invDel.count}, CaseDocument fayl=${filesRemoved}, skan yozuvi=${scanRemoved}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
