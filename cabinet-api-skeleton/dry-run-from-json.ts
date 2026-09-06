// cabinet-api-skeleton/dry-run-from-json.ts
// case_3505.json (prisma'dan oldindan eksport qilingan, MySQL ochilmaydi) + local fayllar
// asosida cabinet.sud.uz'ga XAVFSIZ SINOV: draft yaratish -> ishtirokchilar -> hujjat
// yuklash -> save-suit -> DRAFTNI O'CHIRISH. submitCase(..., {dryRun:true}) send-to-court'ga
// HECH QACHON yetmaydi (submitter.ts: dryRun true bo'lsa step 8'dan oldin qaytadi).
//
//   npx tsx cabinet-api-skeleton/dry-run-from-json.ts case_3505.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { CabinetSubmitEngine } from './submitter';
import { resolveCabinetCourtGuid } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

async function readIfExists(p: string): Promise<Buffer | null> {
  try { return await fs.readFile(p); } catch { return null; }
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Foydalanish: npx tsx cabinet-api-skeleton/dry-run-from-json.ts <case.json>'); process.exit(1); }

  const dump = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const ac = dump.ac;
  const sess = (dump.sess || [])[0];
  if (!ac || !sess) throw new Error('JSON ichida ac yoki sess topilmadi');

  const firmStir = String(sess.account || '').replace(/\D/g, '');
  const courtGuid = resolveCabinetCourtGuid(ac.court);

  console.log('======================================================');
  console.log(`SUDGA YUBORISH — DRY-RUN (JSON'dan, MySQL OCHILMAGAN): Case #${ac.id}`);
  console.log(`Mijoz : ${ac.clientName} (PINFL: ${ac.pinfl})`);
  console.log(`Sud   : ${ac.court?.shortName} (Portal GUID: ${courtGuid})`);
  console.log(`Qarz  : ${Number(ac.totalDebt).toLocaleString()} so'm`);
  console.log('======================================================\n');

  const caseData: SourceCaseData = {
    courtId: courtGuid,
    firm: {
      name: sess.org || 'BRIGHT FUTURE FINANCING MIKROMOLIYA TASHKILOTI MCHJ MMT',
      shortName: 'BRIGHT FUTURE FINANCING',
      stir: firmStir,
      address: 'Toshkent sh.',
      bankAccount: '',
      mfo: '',
      phone: '998993058435',
      director: sess.keyCn || 'BOYNAZAROV AKRAM ANVAROVICH',
    },
    debtor: {
      pinfl: ac.pinfl || '',
      fullName: ac.clientName || '',
      passportSn: '', // Loan jadvali kerak (MySQL) — dry-run uchun bo'sh, real submitda SHART.
      address: 'Toshkent sh.',
    },
    debt: {
      principal: Number(ac.totalDebt) || 0,
      interest: 0,
      penalty: 0,
      total: Number(ac.totalDebt) || 0,
    },
    receiptNumber: ac.receiptNumber || undefined,
  };

  const filesToUpload: CaseFileToUpload[] = [];
  const home = process.env.HOME || '';

  // 1) Palatadan imzolangan ariza (scp qilingan bitta fayl)
  const arizaBuf = await readIfExists('/tmp/DAVRONOV_signed_ariza.pdf');
  if (arizaBuf) filesToUpload.push({ kind: 'ARIZA', fileName: 'Qarzdor_DAVRONOV_XURSHED_XUSENOVICH.pdf', buffer: arizaBuf });

  // 2) Oferta(lar) — local Downloads papkasidan
  const ofertaDir = path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 3', `${ac.clientName} ${ac.pinfl}`);
  try {
    for (const f of await fs.readdir(ofertaDir)) {
      if (f.endsWith('.pdf')) {
        const buf = await readIfExists(path.join(ofertaDir, f));
        if (buf) filesToUpload.push({ kind: 'OFERTA', fileName: f, buffer: buf });
      }
    }
  } catch {}

  // 3) Firma hujjatlari (Guvohnoma / Ishonchnoma)
  const guvoxBuf = await readIfExists(path.join(home, 'Downloads', 'Guvoxnoma BRIGHT.pdf'));
  if (guvoxBuf) filesToUpload.push({ kind: 'GUVOHNOMA', fileName: 'Guvoxnoma BRIGHT.pdf', buffer: guvoxBuf });
  const ishonchBuf = await readIfExists(path.join(home, 'Downloads', 'Ishonchnoma BRIGHT.pdf'));
  if (ishonchBuf) filesToUpload.push({ kind: 'ISHONCHNOMA', fileName: 'Ishonchnoma BRIGHT.pdf', buffer: ishonchBuf });

  console.log(`Yuklanadigan hujjatlar soni: ${filesToUpload.length} ta`);
  filesToUpload.forEach((f, i) => console.log(`  [${i + 1}] ${f.kind} -> ${f.fileName}`));

  const engine = new CabinetSubmitEngine({ token: sess.accessToken, account: firmStir, orgName: caseData.firm.shortName });

  console.log('\n🔍 DRY-RUN: draft -> ishtirokchilar -> hujjat yuklash -> save-suit -> DRAFT O\'CHIRILADI.');
  console.log('   send-to-court HECH QACHON chaqirilmaydi (submitter.ts dryRun shart).\n');

  const result = await engine.submitCase(caseData, filesToUpload, { dryRun: true, courtGuid });

  console.log('\n======================================================');
  if (result.ok) {
    console.log('✅ DRY-RUN MUVAFFAQIYATLI — cabinet.sud.uz to\'liq zanjirni qabul qildi, draft o\'chirildi.');
    console.log(`   draftId=${result.draftId}  claimId=${result.claimId}  yuklangan fayllar=${result.uploadedFiles?.length}`);
  } else {
    console.log('❌ DRY-RUN XATO (qaysi bosqichda to\'xtaganini yuqoridagi loglardan ko\'ring):');
    console.log(`   ${result.error}`);
  }
  console.log('======================================================');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
