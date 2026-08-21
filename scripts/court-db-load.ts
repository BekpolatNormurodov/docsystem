// ─────────────────────────────────────────────────────────────────────────────
// COURT-DB-LOAD — assembled court folderlaridagi ishlarni DB ga yozadi (status bilan).
// Hech narsa yubormaydi/zip qilmaydi — faqat ArizaCase (ilovaning konveyeri) ni to'ldiradi.
//
// Har mijoz-ish → ArizaCase (firm, pinfl, clientName, kod, stage, meta).
//   TAYYOR (hamma hujjat bor) → stage ARIZA_GENERATED
//   KAM   (biror hujjat yo'q)  → stage IMPORTED
// Yuborilgan (COURT_SUBMITTED) ish stage'i qayta yozilmaydi (saqlanadi).
// Idempotent: qayta ishga tushirsa yangilaydi, dublikat yaratmaydi.
//
// Run:
//   npx tsx scripts/court-db-load.ts --dry     # nima yozilishini ko'rsatadi (DB ga tegmaydi)
//   npx tsx scripts/court-db-load.ts           # DB ga yozadi
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prisma } from '@/lib/db';

const HOME = os.homedir();
const FIRMS: { code: string; name: string; dir: string }[] = [
  { code: '12842', name: 'BRIGHT',    dir: path.join(HOME, 'Downloads', '5-sud BRIGHT TAYYOR') },
  { code: '06292', name: 'URBAN',     dir: path.join(HOME, 'Downloads', '5-sud URBAN TAYYOR') },
  { code: '55890', name: 'COMMUNITY', dir: path.join(HOME, 'Downloads', '5-sud COMMUNITY TAYYOR') },
];
const CHIQDI = path.join(HOME, 'Downloads', 'OFERTA_CHIQDI');
const SRC_NAME = 'SUDGA YUBORISH (court packages)'; // send-court.ts shu nom bo'yicha topadi
const DRY = process.argv.includes('--dry');
const norm = (s: string) => s.toUpperCase().replace(/[`'ʻʼ‘’]/g, "'").replace(/\s+/g, ' ').replace(/\.PDF$/, '').trim();

function pinflMap(): Map<string, string> {
  const m = new Map<string, string>();
  if (!fs.existsSync(CHIQDI)) return m;
  for (const firm of fs.readdirSync(CHIQDI)) {
    const fp = path.join(CHIQDI, firm); if (!fs.statSync(fp).isDirectory()) continue;
    for (const cl of fs.readdirSync(fp)) { const mm = cl.match(/^(\d{14})\s+(.*)$/); if (mm) m.set(norm(mm[2]), mm[1]); }
  }
  return m;
}
function checkMissing(dir: string, client: string): string[] {
  const files = fs.readdirSync(dir); const nf = norm(client); const m: string[] = [];
  if (!(files.some(f => norm(f) === nf) || files.some(f => /talabnoma/i.test(f)))) m.push('talabnoma');
  if (!files.some(f => /ariza|arizza/i.test(f))) m.push('ariza');
  if (!files.some(f => /guvox/i.test(f))) m.push('guvoxnoma');
  if (!files.some(f => /ishonch/i.test(f))) m.push('ishonchnoma');
  if (!files.some(f => /shartnoma/i.test(f))) m.push('shartnoma');
  if (!files.some(f => /receipt|td\d+_/i.test(f) || /^кимга/i.test(f))) m.push('kvitansiya');
  if (!files.some(f => /oferta/i.test(f) && /\.pdf$/i.test(f))) m.push('oferta');
  return m;
}
interface Case { firmCode: string; firm: string; client: string; docs: number; oferta: number; status: 'TAYYOR' | 'KAM'; missing: string[] }
function scan(): Case[] {
  const out: Case[] = [];
  for (const F of FIRMS) {
    if (!fs.existsSync(F.dir)) continue;
    for (const client of fs.readdirSync(F.dir).sort()) {
      const dir = path.join(F.dir, client); if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f));
      const missing = checkMissing(dir, client);
      out.push({ firmCode: F.code, firm: F.name, client, docs: files.length,
        oferta: files.filter(f => /oferta/i.test(f)).length, status: missing.length ? 'KAM' : 'TAYYOR', missing });
    }
  }
  return out;
}

async function main() {
  const cases = scan();
  const pinfl = pinflMap();
  const byFirm: Record<string, { tayyor: number; kam: number }> = {};
  for (const c of cases) { (byFirm[c.firm] ??= { tayyor: 0, kam: 0 })[c.status === 'TAYYOR' ? 'tayyor' : 'kam']++; }
  console.log(`════════ COURT-DB-LOAD ${DRY ? '(DRY — DB ga yozilmaydi)' : ''} ════════`);
  console.log(`Ish (mijoz-firma): ${cases.length}`);
  for (const [f, v] of Object.entries(byFirm)) console.log(`  ${f.padEnd(10)}: ${v.tayyor + v.kam}  (tayyor ${v.tayyor}, kam ${v.kam})`);

  if (DRY) {
    const noPinfl = cases.filter(c => !pinfl.get(norm(c.client))).length;
    console.log(`\nDB ga yoziladi: ${cases.length - noPinfl} ish${noPinfl ? ` | ${noPinfl} pinfl topilmadi (yozilmaydi)` : ''}`);
    console.log('(DRY — hech narsa yozilmadi)');
    return;
  }

  const firms = await prisma.firm.findMany({ select: { id: true, code: true } });
  const firmId = new Map<string, number>(firms.map(f => [f.code, f.id]));
  const today = new Date(); const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const snap = await prisma.snapshot.upsert({
    where: { reportDate: d }, update: { status: 'READY', sourceFileName: SRC_NAME },
    create: { reportDate: d, sourceFileName: SRC_NAME, status: 'READY', rowCount: cases.length },
  });

  let wrote = 0, noPinfl = 0;
  for (const c of cases) {
    const fid = firmId.get(c.firmCode); const pin = pinfl.get(norm(c.client));
    if (!fid || !pin) { noPinfl++; continue; }
    await prisma.arizaCase.upsert({
      where: { snapshotId_pinfl_firmId: { snapshotId: snap.id, pinfl: pin, firmId: fid } },
      update: { clientName: c.client, kod: c.firmCode, meta: { pkgDocs: c.docs, pkgOferta: c.oferta, pkgMissing: c.missing } }, // stage saqlanadi (COURT_SUBMITTED tegilmaydi)
      create: { snapshotId: snap.id, firmId: fid, pinfl: pin, clientName: c.client, kod: c.firmCode,
        stage: c.status === 'TAYYOR' ? 'ARIZA_GENERATED' : 'IMPORTED', totalDebt: 0,
        meta: { pkgDocs: c.docs, pkgOferta: c.oferta, pkgMissing: c.missing } },
    });
    wrote++;
  }
  const byStage = await prisma.arizaCase.groupBy({ by: ['stage'], where: { snapshotId: snap.id }, _count: { _all: true } });
  console.log(`\nDB: snapshot #${snap.id} | ${wrote} ish yozildi/yangilandi${noPinfl ? ` | ${noPinfl} pinfl topilmadi` : ''}`);
  console.log('  stage bo\'yicha:', byStage.map((r: any) => `${r.stage}:${r._count._all}`).join('  '));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { try { await prisma.$disconnect(); } catch { /* noop */ } });
