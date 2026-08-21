// ─────────────────────────────────────────────────────────────────────────────
// SUDGA YUBORISH — status-based, paced (1/min), resumable court-submission runner.
//
// Scans the assembled per-firm court folders, computes each client-case's status
// (TAYYOR / KAM), then walks the READY cases ONE PER INTERVAL (default 60s),
// staging a per-client zip, logging progress to the terminal, and recording status
// so it can be STOPPED (Ctrl-C) and CONTINUED later from where it left off.
//
// Actual upload to the e-sud portal is the user's step; this script PACES, STAGES
// (per-client zip + optional Finder reveal) and TRACKS. It never transmits anywhere.
//
// Run:
//   npx tsx scripts/send-court.ts --status            # holat jadvali (hech nima yubormaydi)
//   npx tsx scripts/send-court.ts --dry               # rejani ko'rsatadi (belgilamaydi)
//   npx tsx scripts/send-court.ts --limit 100         # 100 tagacha, 60s oraliq bilan
//   npx tsx scripts/send-court.ts --limit 100 --interval 60 --open
//   npx tsx scripts/send-court.ts --confirm           # har birida Enter kutadi
//   npx tsx scripts/send-court.ts --reset             # SENT belgilarini tozalaydi
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import archiver from 'archiver';

const HOME = os.homedir();
// Firm court folders (BRIGHT ready now; others auto-included when their folder exists).
const FIRMS: { code: string; name: string; dir: string }[] = [
  { code: '12842', name: 'BRIGHT',    dir: path.join(HOME, 'Downloads', '5-sud BRIGHT TAYYOR') },
  { code: '06292', name: 'URBAN',     dir: path.join(HOME, 'Downloads', '5-sud URBAN TAYYOR') },
  { code: '55890', name: 'COMMUNITY', dir: path.join(HOME, 'Downloads', '5-sud COMMUNITY TAYYOR') },
];
const STATE = path.join(HOME, 'Downloads', 'sud_holat.json');
const STAGE = path.join(HOME, 'Downloads', 'SUD_YUBORISH');

// ---- args ----
const A = process.argv.slice(2);
const has = (f: string) => A.includes(f);
const val = (f: string, d: number) => { const i = A.indexOf(f); return i >= 0 && A[i + 1] ? Number(A[i + 1]) : d; };
const LIMIT = val('--limit', 100);
const INTERVAL = val('--interval', 60);          // seconds between sends
const DRY = has('--dry'), STATUS = has('--status'), CONFIRM = has('--confirm'), OPEN = has('--open'), RESET = has('--reset');
const USE_DB = !has('--no-db');
const CHIQDI = path.join(HOME, 'Downloads', 'OFERTA_CHIQDI');

const norm = (s: string) => s.toUpperCase().replace(/[`'ʻʼ‘’]/g, "'").replace(/\s+/g, ' ').replace(/\.PDF$/, '').trim();
let dbClient: any = null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const clock = () => new Date().toTimeString().slice(0, 8);

// ---- completeness: what a court-ready case needs ----
interface Chk { davo: boolean; ariza: boolean; guvox: boolean; ishonch: boolean; shart: boolean; receipt: boolean; oferta: number }
function checkFolder(dir: string, client: string): Chk {
  const files = fs.readdirSync(dir); const nf = norm(client);
  return {
    davo: files.some(f => norm(f) === nf) || files.some(f => /talabnoma/i.test(f)),
    ariza: files.some(f => /ariza|arizza/i.test(f)),
    guvox: files.some(f => /guvox/i.test(f)),
    ishonch: files.some(f => /ishonch/i.test(f)),
    shart: files.some(f => /shartnoma/i.test(f)),
    receipt: files.some(f => /receipt|td\d+_/i.test(f) || /^кимга/i.test(f)),
    oferta: files.filter(f => /oferta/i.test(f) && /\.pdf$/i.test(f)).length,
  };
}
function missingOf(c: Chk): string[] {
  const m: string[] = [];
  if (!c.davo) m.push('talabnoma'); if (!c.ariza) m.push('ariza'); if (!c.guvox) m.push('guvoxnoma');
  if (!c.ishonch) m.push('ishonchnoma'); if (!c.shart) m.push('shartnoma'); if (!c.receipt) m.push('kvitansiya');
  if (c.oferta === 0) m.push('oferta');
  return m;
}

interface Case { key: string; firm: string; firmCode: string; client: string; dir: string;
  docs: number; oferta: number; status: 'TAYYOR' | 'KAM'; missing: string[] }

function scanCases(): Case[] {
  const out: Case[] = [];
  for (const F of FIRMS) {
    if (!fs.existsSync(F.dir)) continue;
    for (const client of fs.readdirSync(F.dir).sort()) {
      const dir = path.join(F.dir, client);
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f));
      const c = checkFolder(dir, client);
      const missing = missingOf(c);
      out.push({ key: `${F.code}/${client}`, firm: F.name, firmCode: F.code, client, dir,
        docs: files.length, oferta: c.oferta, status: missing.length ? 'KAM' : 'TAYYOR', missing });
    }
  }
  return out;
}

// ---- state (JSON, atomic) — resumability source of truth ----
interface StRec { status: 'SENT' | 'READY' | 'KAM'; sentAt?: string; zip?: string; note?: string }
type State = Record<string, StRec>;
function loadState(): State { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } }
function saveState(s: State) { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, STATE); }

function stageZip(c: Case): Promise<string> {
  fs.mkdirSync(STAGE, { recursive: true });
  const zip = path.join(STAGE, `${c.firm}__${c.client}`.replace(/[/\\]/g, '_').slice(0, 120) + '.zip');
  return new Promise((res, rej) => {
    const out = fs.createWriteStream(zip); const ar = archiver('zip', { zlib: { level: 6 } });
    out.on('close', () => res(zip)); ar.on('error', rej); ar.pipe(out);
    ar.directory(c.dir, c.client); ar.finalize();
  });
}
const reveal = (p: string) => new Promise<void>(r => execFile('open', ['-R', p], () => r()));
function ask(q: string): Promise<string> {
  return new Promise(res => { process.stdout.write(q); const on = (d: Buffer) => { process.stdin.pause(); process.stdin.off('data', on); res(d.toString().trim()); }; process.stdin.resume(); process.stdin.on('data', on); });
}

// ─────────── DB layer (best-effort; ilovaning ArizaCase / CaseStage bilan) ───────────
// pinfl map: mijoz nomi -> PINFL (OFERTA_CHIQDI papka nomlaridan)
function pinflMap(): Map<string, string> {
  const m = new Map<string, string>();
  if (!fs.existsSync(CHIQDI)) return m;
  for (const firm of fs.readdirSync(CHIQDI)) {
    const fp = path.join(CHIQDI, firm); if (!fs.statSync(fp).isDirectory()) continue;
    for (const cl of fs.readdirSync(fp)) { const mm = cl.match(/^(\d{14})\s+(.*)$/); if (mm) m.set(norm(mm[2]), mm[1]); }
  }
  return m;
}
// Sender only READS the snapshot the separate loader (court-db-load.ts) created, and on send
// advances the matching ArizaCase → COURT_SUBMITTED. It does NOT bulk-populate the DB itself.
interface Db { snapId: number; firmId: Map<string, number>; pinfl: Map<string, string>; prisma: any }
async function dbInit(): Promise<Db | null> {
  if (!USE_DB) return null;
  try {
    const { prisma } = await import('@/lib/db');
    const snap = await prisma.snapshot.findFirst({ where: { sourceFileName: { contains: 'SUDGA YUBORISH' } }, orderBy: { id: 'desc' }, select: { id: true } });
    if (!snap) { console.log("  DB: ish yuklanmagan — avval `npx tsx scripts/court-db-load.ts` ni ishga tushiring (JSON holat bilan davom etadi)"); return null; }
    const firms = await prisma.firm.findMany({ select: { id: true, code: true } });
    const firmId = new Map<string, number>(firms.map((f: any) => [f.code, f.id]));
    console.log(`  DB: snapshot #${snap.id} (yuborilganda stage → COURT_SUBMITTED)`);
    return { snapId: snap.id, firmId, pinfl: pinflMap(), prisma };
  } catch (e) {
    console.log(`  DB: ulanmadi (${(e as Error).message.slice(0, 80)}) — JSON holat bilan davom etadi`);
    return null;
  }
}
async function dbSubmit(db: Db | null, c: Case, zip: string) {
  if (!db) return;
  const fid = db.firmId.get(c.firmCode); const pin = db.pinfl.get(norm(c.client));
  if (!fid || !pin) return;
  try {
    await db.prisma.arizaCase.update({
      where: { snapshotId_pinfl_firmId: { snapshotId: db.snapId, pinfl: pin, firmId: fid } },
      data: { stage: 'COURT_SUBMITTED', stageEnteredAt: new Date(), meta: { exportedAt: nowIso(), zip, pkgDocs: c.docs, pkgOferta: c.oferta } },
    });
  } catch { /* best-effort */ }
}

async function main() {
  const cases = scanCases();
  const state = loadState();
  if (RESET) {
    for (const k of Object.keys(state)) if (state[k].status === 'SENT') delete state[k]; saveState(state);
    let dbMsg = '';
    if (USE_DB) try {
      const { prisma } = await import('@/lib/db'); dbClient = prisma;
      const r = await prisma.arizaCase.updateMany({ where: { stage: 'COURT_SUBMITTED' }, data: { stage: 'ARIZA_GENERATED', stageEnteredAt: new Date() } });
      dbMsg = ` | DB: ${r.count} ish COURT_SUBMITTED→ARIZA_GENERATED`;
    } catch { dbMsg = ' | DB: ulanmadi'; }
    console.log('SENT belgilar tozalandi.' + dbMsg); return;
  }

  // reconcile status into state (preserve SENT)
  for (const c of cases) { if (state[c.key]?.status === 'SENT') continue; state[c.key] = { status: c.status === 'TAYYOR' ? 'READY' : 'KAM', note: c.missing.join(',') || undefined }; }
  saveState(state);
  const db = await dbInit();
  dbClient = db?.prisma ?? null;

  const tayyor = cases.filter(c => c.status === 'TAYYOR');
  const kam = cases.filter(c => c.status === 'KAM');
  const sent = cases.filter(c => state[c.key]?.status === 'SENT');
  const queue = tayyor.filter(c => state[c.key]?.status !== 'SENT');

  console.log('════════════ SUDGA YUBORISH — HOLAT ════════════');
  for (const F of FIRMS) { const n = cases.filter(c => c.firmCode === F.code).length; if (n) console.log(`  ${F.name.padEnd(10)}: ${n} ish  (tayyor ${cases.filter(c=>c.firmCode===F.code&&c.status==='TAYYOR').length}, kam ${cases.filter(c=>c.firmCode===F.code&&c.status==='KAM').length})`); }
  console.log(`  ─ JAMI: ${cases.length} ish | TAYYOR ${tayyor.length} | KAM ${kam.length}`);
  console.log(`  ─ Avval yuborilgan: ${sent.length} | Navbatda (tayyor, yuborilmagan): ${queue.length}`);
  if (kam.length) { console.log('\n  ⚠ KAM (yuborilmaydi):'); kam.slice(0, 20).forEach(c => console.log(`     ${c.firm} / ${c.client} — ${c.missing.join(', ')}`)); if (kam.length > 20) console.log(`     …+${kam.length - 20}`); }

  if (STATUS) return;
  if (!queue.length) { console.log('\nNavbat bo\'sh — hamma tayyor ish yuborilgan.'); return; }

  const take = queue.slice(0, LIMIT);
  console.log(`\n${DRY ? '[DRY] ' : ''}Yuboriladi: ${take.length} ta (oraliq ${INTERVAL}s). To'xtatish: Ctrl-C — keyin qayta ishga tushirsangiz davom etadi.\n`);

  let n = 0;
  for (const c of take) {
    n++;
    const head = `[${clock()}] (${n}/${take.length}, jami ${sent.length + n}) ${c.firm} / ${c.client}`;
    if (DRY) { console.log(`${head}  — hujjat:${c.docs} oferta:${c.oferta}  [DRY, belgilanmadi]`); continue; }
    try {
      const zip = await stageZip(c);
      if (OPEN) await reveal(zip);
      state[c.key] = { status: 'SENT', sentAt: nowIso(), zip };
      saveState(state);
      await dbSubmit(db, c, zip);
      console.log(`${head}  — hujjat:${c.docs} oferta:${c.oferta}  ✔ tayyorlandi → ${zip}`);
    } catch (e) {
      state[c.key] = { status: 'READY', note: 'ERROR: ' + (e as Error).message }; saveState(state);
      console.log(`${head}  — ❌ XATO: ${(e as Error).message}`);
    }
    if (n < take.length) {
      if (CONFIRM) { await ask('   ↳ Yuborildi? [Enter] keyingisi, yoki Ctrl-C to\'xtatish… '); }
      else { process.stdout.write(`   … ${INTERVAL}s kutilyapti\r`); await sleep(INTERVAL * 1000); }
    }
  }
  console.log(`\nTUGADI. Ushbu seansda: ${n} ta. Umumiy yuborilgan: ${sent.length + n}/${tayyor.length}. Holat: ${STATE}`);
}
main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { try { await dbClient?.$disconnect(); } catch { /* noop */ } });
