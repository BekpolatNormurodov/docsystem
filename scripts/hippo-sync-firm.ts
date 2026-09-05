/**
 * hippo-sync-firm.ts — bitta firma uchun xat.hippo SYNC (ingest) ni CLI'dan ishga tushiradi,
 * app UI'siz, va hippo NECHTA talabnoma xatи berayotganини aniq ko'rsatadi. «Community 0» —
 * hippo'да xat yo'qmi yoki shunchaki sync bosilmaganmi — shuni hal qiladi.
 *
 *   node --import tsx scripts/hippo-sync-firm.ts --firm COMMUNITY          # sync + hisobot
 *   node --import tsx scripts/hippo-sync-firm.ts --firm COMMUNITY --attach # sync + cheklarni biriktir
 */
import { prisma } from '../src/lib/db';
import { getStoredHippoSession } from '../src/lib/hippo/session';
import { ingestHippoStatuses } from '../src/lib/hippo/status-ingest';
import { listRegistries } from '../src/lib/hippo/xat';
import { attachTalabnomaReceipts } from '../src/lib/hippo/attach-receipts';

const digits = (s) => (s ?? '').replace(/\D+/g, '');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const ATTACH = process.argv.includes('--attach');

async function main() {
  const key = (arg('--firm') || 'COMMUNITY').toUpperCase();
  const firm = await prisma.firm.findFirst({ where: { shortName: { contains: key } }, select: { id: true, code: true, shortName: true, stir: true } });
  if (!firm) throw new Error(`Firma topilmadi: ${key}`);
  console.log(`Firma: ${firm.shortName} (id ${firm.id}, code ${firm.code}, stir ${digits(firm.stir)})`);

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch (e) { console.error('✗ xat.hippo ga ulanmagan (sessiya yo‘q/eskirgan):', e instanceof Error ? e.message : e); process.exit(2); }

  // Diagnostika: hippo'da shu hisob ostida nechta reyestr bor?
  try {
    const regs = await listRegistries(session, {});
    const j = (regs && typeof regs === 'object' && 'json' in regs) ? regs.json : regs;
    const arr = Array.isArray(j) ? j : (j?.items ?? j?.data ?? j?.content ?? []);
    console.log(`xat.hippo reyestrlari (1-sahifa): ${Array.isArray(arr) ? arr.length : '?'}`);
  } catch (e) { console.error('listRegistries xato:', e instanceof Error ? e.message : e); }

  console.log('Sync (ingest) boshlandi…');
  const r = await ingestHippoStatuses(session, firm.code);
  console.log(`✅ SYNC natijasi: totalMails=${r.totalMails}, matched=${r.matched}, unmatched=${r.unmatched}`);
  if (r.totalMails === 0) {
    console.log('→ hippo bu firma hisobida 0 talabnoma xatи berdi. Demak talabnomalar boshqa hisob/kanal orqali ketgan (Bright kabi) — kvitansiya hippo\'dan kelmaydi.');
  }

  if (ATTACH && r.totalMails > 0) {
    console.log('Cheklarni biriktirish…');
    const a = await attachTalabnomaReceipts(session, { id: firm.id, code: firm.code }, { limit: 100 });
    console.log(`✅ ATTACH: +${a.attached} biriktirildi, ${a.skipped} avval bor, ${a.failed} xato, nomzod=${a.candidates}, qoldi=${a.todo - a.attached}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
