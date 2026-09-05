/**
 * import-firm-docs.ts — firma hujjatlarini (guvohnoma/ishonchnoma/shartnoma) papkadagi
 * PDF'lardan bazaga (FirmDocument) yuklaydi. Fayl nomidan firma + turni aniqlaydi:
 *   firma:  bright|communit|urban|fund
 *   tur:    guvoh/guvox → GUVOHNOMA,  ishonch → ISHONCHNOMA,  shartn → SHARTNOMA
 *
 * MAXSUS QOIDA: ISHONCHNOMA (Bright'niki) — 4 firmaga HAM biriktiriladi (foydalanuvchi:
 * «Bright ishonchnomasi hammasiga o'tadi»).
 *
 * Har (firma, tur) uchun bittadan — mavjudi almashtiriladi (firm-doc route bilan bir xil).
 * Fayllar exports/firm-docs/<firmId>/ ga ko'chiriladi.
 *
 *   node --import tsx scripts/import-firm-docs.ts --dir <papka>          # dry-run (rejani ko'rsatadi)
 *   node --import tsx scripts/import-firm-docs.ts --dir <papka> --go     # yozadi
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import type { FirmDocKind } from '@prisma/client';

const GO = process.argv.includes('--go');
const dirArg = (() => { const i = process.argv.indexOf('--dir'); return i >= 0 ? process.argv[i + 1] : path.join(process.cwd(), 'firm-docs'); })();
const DEST = path.join(process.cwd(), 'exports', 'firm-docs');
const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120);

const FIRM_KEYS: [RegExp, string][] = [
  [/bright/i, 'BRIGHT'], [/communit/i, 'COMMUNITY'], [/urban/i, 'URBAN'], [/fund/i, 'FUNDFLOW'],
];
const ALL_FIRM_KEYS = ['BRIGHT', 'COMMUNITY', 'URBAN', 'FUNDFLOW'];

function kindOf(name: string): FirmDocKind | null {
  const s = name.toLowerCase();
  if (/guvo[hx]/.test(s)) return 'GUVOHNOMA';
  if (/ishonch/.test(s)) return 'ISHONCHNOMA';
  if (/shartn/.test(s)) return 'SHARTNOMA';
  return null;
}
function firmKeyOf(name: string): string | null {
  return FIRM_KEYS.find(([re]) => re.test(name))?.[1] ?? null;
}

async function firmByKey(key: string) {
  return prisma.firm.findFirst({ where: { shortName: { contains: key } }, select: { id: true, shortName: true } });
}

async function main() {
  const files = (await fs.readdir(dirArg)).filter((f) => /\.(pdf|docx|png|jpe?g)$/i.test(f));
  if (!files.length) { console.error(`Papkada hujjat topilmadi: ${dirArg}`); process.exit(1); }
  console.log(`Rejim: ${GO ? 'GO (yoziladi!)' : 'DRY-RUN'} | papka: ${dirArg}\n`);

  // Reja: (firma, tur) → manba fayl. Ishonchnoma bo'lsa — 4 firmaga.
  type Plan = { firmKey: string; kind: FirmDocKind; file: string };
  const plans: Plan[] = [];
  for (const f of files) {
    const kind = kindOf(f);
    if (!kind) { console.log(`⚠ tur aniqlanmadi, o'tkazildi: ${f}`); continue; }
    if (kind === 'ISHONCHNOMA') {
      for (const fk of ALL_FIRM_KEYS) plans.push({ firmKey: fk, kind, file: f });
    } else {
      const fk = firmKeyOf(f);
      if (!fk) { console.log(`⚠ firma aniqlanmadi, o'tkazildi: ${f}`); continue; }
      plans.push({ firmKey: fk, kind, file: f });
    }
  }

  for (const p of plans) console.log(`  ${p.firmKey.padEnd(10)} ${p.kind.padEnd(12)} ← ${p.file}`);
  console.log(`\nJami biriktirish: ${plans.length}`);
  if (!GO) { console.log('\nDRY-RUN — yozilmadi. `--go` bilan qayta ishga tushiring.'); await prisma.$disconnect(); return; }

  let ok = 0;
  for (const p of plans) {
    const firm = await firmByKey(p.firmKey);
    if (!firm) { console.log(`✗ firma topilmadi: ${p.firmKey}`); continue; }
    const src = path.join(dirArg, p.file);
    const dir = path.join(DEST, String(firm.id));
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(p.file);
    const dest = path.join(dir, `${p.kind}-${Date.now()}-${safe(p.file)}`);
    await fs.copyFile(src, dest);
    // Upsert: bitta (firma, tur) — eskisini o'chirib, yangisini yozamiz.
    const old = await prisma.firmDocument.findMany({ where: { firmId: firm.id, kind: p.kind }, select: { id: true, filePath: true } });
    await prisma.firmDocument.create({ data: { firmId: firm.id, kind: p.kind, label: `${p.kind}${ext}`, filePath: dest } });
    if (old.length) {
      await Promise.all(old.map((d) => fs.rm(d.filePath, { force: true }).catch(() => {})));
      await prisma.firmDocument.deleteMany({ where: { id: { in: old.map((d) => d.id) } } });
    }
    ok++;
    console.log(`✅ ${firm.shortName} — ${p.kind}`);
  }
  console.log(`\nBajarildi: ${ok}/${plans.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
