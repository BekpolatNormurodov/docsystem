// cabinet-api-skeleton/send-batch.ts
// Bir nechta ishlarni ketma-ketlikda (sequential) va portal rate-limitlarini
// inobatga olgan holda cabinet.sud.uz ga kiritish dvigateli.
//
// Foydalanish:
//   npx tsx cabinet-api-skeleton/send-batch.ts --firm 1 --limit 5
//   npx tsx cabinet-api-skeleton/send-batch.ts --cases 2118,2119 --dry-run
//   npx tsx cabinet-api-skeleton/send-batch.ts --firm 1 --limit 10 --delay 20
//
// Parametrlar:
//   --firm <id>       Firma ID (masalan 1 - BRIGHT FUTURE FINANCING)
//   --limit <soni>    Yuboriladigan ishlar soni (standart: 10, max: 100)
//   --cases <id,id>   Aniq case ID ro'yxati (vergul bilan)
//   --delay <soniya>  Har bir ish orasidagi xavfsiz kutish vaqti (standart: 15s)
//   --dry-run         Sinov rejimi: qoralamani yaratadi, tekshiradi va o'chiradi (sudga yubormaydi)
//   --force           Bosqichi nima bo'lishidan qat'i nazar yuborishga urinish

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { CabinetSubmitEngine } from './submitter';
import { resolveCabinetCourtGuid, CABINET_COURT_IDS, CABINET_REGION_IDS } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

const CLAIMANT_ID_BY_STIR: Record<string, string> = {
  '311976765': 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a', // BRIGHT FUTURE FINANCING
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isForce = args.includes('--force');

  let firmId: number | undefined;
  let limit = 10;
  let delaySec = 15;
  let caseIds: number[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--firm' && args[i + 1]) {
      firmId = Number(args[++i]);
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = Math.min(100, Math.max(1, Number(args[++i]) || 10));
    } else if (args[i] === '--delay' && args[i + 1]) {
      delaySec = Math.max(2, Number(args[++i]) || 15);
    } else if (args[i] === '--cases' && args[i + 1]) {
      caseIds = args[++i]
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    }
  }

  return { isDryRun, isForce, firmId, limit, delaySec, caseIds };
}

async function collectCaseFiles(ac: any): Promise<CaseFileToUpload[]> {
  const filesToUpload: CaseFileToUpload[] = [];

  // A) DB dagi CaseDocument yozuvlaridan
  for (const doc of ac.documents || []) {
    try {
      let fPath = doc.filePath;
      if (fPath.startsWith('/app/')) {
        fPath = path.join(process.cwd(), fPath.replace(/^\/app\//, ''));
      }
      const buf = await fs.readFile(fPath);
      let kind: CaseFileToUpload['kind'] = 'OFERTA';
      if (doc.kind === 'SIGNED_ARIZA' || doc.kind === 'ARIZA') kind = 'ARIZA';
      else if (doc.kind === 'TALABNOMA') kind = 'TALABNOMA';
      else if (doc.kind === 'TALABNOMA_RECEIPT') kind = 'TALABNOMA_CHECK';
      else if (doc.kind === 'GUVOHNOMA') kind = 'GUVOHNOMA';
      else if (doc.kind === 'ISHONCHNOMA') kind = 'ISHONCHNOMA';

      filesToUpload.push({ kind, fileName: doc.fileName, buffer: buf });
    } catch {}
  }

  // B) Diskdagi papkalardan qidirish (Oferta va boshqa ilovalar)
  const home = process.env.HOME || '';
  if (ac.clientName) {
    const candidateDirs = [
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 3', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 2', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', '5-sud BRIGHT TAYYOR', ac.clientName),
    ];
    for (const cDir of candidateDirs) {
      try {
        const list = await fs.readdir(cDir);
        for (const fname of list) {
          if (!fname.endsWith('.pdf')) continue;
          if (filesToUpload.some((f) => f.fileName === fname)) continue;
          const buf = await fs.readFile(path.join(cDir, fname));
          let kind: CaseFileToUpload['kind'] = 'OFERTA';
          if (/ariza/i.test(fname)) kind = 'ARIZA';
          else if (/talabnoma/i.test(fname)) kind = 'TALABNOMA';
          else if (/receipt|check|td/i.test(fname)) kind = 'TALABNOMA_CHECK';
          else if (/guvox/i.test(fname)) kind = 'GUVOHNOMA';
          else if (/ishonch/i.test(fname)) kind = 'ISHONCHNOMA';
          filesToUpload.push({ kind, fileName: fname, buffer: buf });
        }
        if (filesToUpload.length > 1) break;
      } catch {}
    }
  }

  // C) Tashkilot statik hujjatlari (Guvohnoma, Ishonchnoma)
  const hasGuvox = filesToUpload.some((f) => f.kind === 'GUVOHNOMA');
  const hasIshonch = filesToUpload.some((f) => f.kind === 'ISHONCHNOMA');
  if (!hasGuvox) {
    const paths = [
      path.join(process.cwd(), 'exports', 'firm-docs', String(ac.firmId), 'GUVOHNOMA-Guvoxnoma_BRIGHT.pdf'),
      path.join(home, 'Downloads', 'Guvoxnoma BRIGHT.pdf'),
    ];
    for (const p of paths) {
      try {
        const gBuf = await fs.readFile(p);
        filesToUpload.push({ kind: 'GUVOHNOMA', fileName: 'Guvoxnoma BRIGHT.pdf', buffer: gBuf });
        break;
      } catch {}
    }
  }
  if (!hasIshonch) {
    const paths = [
      path.join(process.cwd(), 'exports', 'firm-docs', String(ac.firmId), 'ISHONCHNOMA-Ishonchnoma_BRIGHT.pdf'),
      path.join(home, 'Downloads', 'Ishonchnoma BRIGHT.pdf'),
    ];
    for (const p of paths) {
      try {
        const iBuf = await fs.readFile(p);
        filesToUpload.push({ kind: 'ISHONCHNOMA', fileName: 'Ishonchnoma BRIGHT.pdf', buffer: iBuf });
        break;
      } catch {}
    }
  }

  return filesToUpload;
}

async function main() {
  const { isDryRun, isForce, firmId, limit, delaySec, caseIds } = parseArgs();

  console.log(`\n======================================================`);
  console.log(`KETMA-KET SUDGA YUBORISH (BATCH SUBMIT ENGINE)`);
  console.log(`Rejim : ${isDryRun ? '🔍 [DRY-RUN - Sinov, sudga yuborilmaydi]' : '🚀 [REAL SUBMIT - Sudga topshiriladi]'}`);
  console.log(`Kutish: Har bir ish orasida ${delaySec} soniya pauza (rate limit himoyasi)`);
  console.log(`======================================================\n`);

  // 1. Yuboriladigan ishlarni topish
  let targetCases: any[] = [];
  if (caseIds.length > 0) {
    targetCases = await prisma.arizaCase.findMany({
      where: { id: { in: caseIds } },
      include: { firm: true, court: true, documents: true },
    });
  } else if (firmId) {
    const whereClause: any = { firmId, courtSentAt: null };
    if (!isForce) {
      whereClause.stage = { in: ['INVOICE_PAID', 'INVOICE_CREATED', 'SIGNED_SCANNED', 'READY'] };
    }
    targetCases = await prisma.arizaCase.findMany({
      where: whereClause,
      include: { firm: true, court: true, documents: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
  } else {
    console.error('❌ Iltimos, --firm <id> yoki --cases <id,id> parametrini ko\'rsating.');
    console.error('Namuna: npx tsx cabinet-api-skeleton/send-batch.ts --firm 1 --limit 5');
    console.error('Namuna: npx tsx cabinet-api-skeleton/send-batch.ts --cases 2118,2119 --dry-run');
    process.exit(1);
  }

  if (targetCases.length === 0) {
    console.log('ℹ Yuborish uchun birorta ham tayyor ish topilmadi.');
    process.exit(0);
  }

  console.log(`Yuklangan ishlar soni: ${targetCases.length} ta\n`);

  const summary = {
    total: targetCases.length,
    succeeded: [] as { id: number; clientName: string; caseNumber?: string; draftId?: string }[],
    failed: [] as { id: number; clientName: string; error: string }[],
  };

  const startTime = Date.now();

  for (let idx = 0; idx < targetCases.length; idx++) {
    const ac = targetCases[idx];
    const caseIndexStr = `[${idx + 1}/${targetCases.length}]`;
    const firmStir = (ac.firm.stir || '').replace(/\D/g, '');

    console.log(`------------------------------------------------------`);
    console.log(`${caseIndexStr} Case #${ac.id}: ${ac.clientName} (PINFL: ${ac.pinfl})`);
    console.log(`Firma : ${ac.firm.shortName} (STIR: ${firmStir})`);
    console.log(`Qarz  : ${Number(ac.totalDebt).toLocaleString()} so'm`);

    // Sessiya olish
    let sessionToken = process.env.CABINET_TOKEN;
    if (!sessionToken) {
      try {
        const session = await getStoredCabinetSession(firmStir);
        sessionToken = session.token;
      } catch (e: any) {
        console.error(`❌ Firmaning faol Cabinet sessiyasi topilmadi: ${e.message}`);
        summary.failed.push({ id: ac.id, clientName: ac.clientName, error: `Sessiya topilmadi: ${e.message}` });
        continue;
      }
    }

    const claimantId = CLAIMANT_ID_BY_STIR[firmStir];
    if (!claimantId) {
      const err = `STIR ${firmStir} uchun claimantId topilmadi`;
      console.error(`❌ ${err}`);
      summary.failed.push({ id: ac.id, clientName: ac.clientName, error: err });
      continue;
    }

    // Sud GUID
    const courtGuid = resolveCabinetCourtGuid(ac.court);

    // Kredit ma'lumotlari
    let loans = await prisma.loan.findMany({
      where: { snapshotId: ac.snapshotId ?? undefined, pinfl: ac.pinfl, branchCode: ac.kod ?? undefined },
    });
    if (loans.length === 0) {
      loans = await prisma.loan.findMany({ where: { pinfl: ac.pinfl, branchCode: ac.kod ?? undefined } });
    }
    if (loans.length === 0) {
      loans = await prisma.loan.findMany({ where: { pinfl: ac.pinfl } });
    }

    const principal = loans.reduce((s, l) => s + Number(l.debtPrincipal || 0) + Number(l.debtOverduePrincipal || 0), 0);
    const interest = loans.reduce((s, l) => s + Number(l.debtTermInterest || 0) + Number(l.debtOverdueInterest || 0), 0);
    const total = Number(ac.totalDebt) || (principal + interest);

    const firstLoan = loans[0];
    const rawLoan = (firstLoan?.raw && typeof firstLoan.raw === 'object' ? firstLoan.raw : {}) as Record<string, any>;
    const passportSn: string = firstLoan?.passportSn || rawLoan['Паспорт'] || '';
    const passportClean = passportSn.replace(/\s+/g, '').toUpperCase();

    const caseData: SourceCaseData = {
      courtId: courtGuid,
      regionId: CABINET_REGION_IDS.TOSHKENT_VILOYATI,
      claimantId,
      firm: { stir: firmStir },
      debtor: {
        pinfl: ac.pinfl || '',
        fullName: ac.clientName || '',
        passportSerial: passportClean.slice(0, 2) || undefined,
        passportNumber: passportClean.slice(2) || undefined,
        phone: firstLoan?.phone || undefined,
        gender: undefined,
        address: firstLoan?.postAddressUz || firstLoan?.postAddress || undefined,
      },
      debt: {
        principal, interest, penalty: 0, fine: 0,
        moralDamage: 0, materialDamage: 0, lostProfit: 0, prepaidExpense: 0,
        total,
      },
    };

    // Hujjatlarni yig'ish
    const filesToUpload = await collectCaseFiles(ac);
    console.log(`Hujjatlar soni: ${filesToUpload.length} ta ([${filesToUpload.map((f) => f.kind).join(', ')}])`);

    // Dvigatel
    const engine = new CabinetSubmitEngine({
      token: sessionToken,
      account: firmStir,
      orgName: ac.firm.shortName,
    });

    try {
      const result = await engine.submitCase(caseData, filesToUpload, { dryRun: isDryRun });

      if (result.ok) {
        if (!isDryRun) {
          await prisma.arizaCase.update({
            where: { id: ac.id },
            data: {
              stage: 'COURT_SUBMITTED',
              stageEnteredAt: new Date(),
              courtSentAt: new Date(),
              courtCaseId: result.caseNumber || result.registryNumber || result.draftId,
              meta: {
                ...((ac.meta as any) || {}),
                cabinetDraftId: result.draftId,
                cabinetSubmittedAt: new Date().toISOString(),
                caseNumber: result.caseNumber,
                registryNumber: result.registryNumber,
              },
            },
          });
        }
        summary.succeeded.push({
          id: ac.id,
          clientName: ac.clientName,
          caseNumber: result.caseNumber,
          draftId: result.draftId,
        });
        console.log(`✔ ${caseIndexStr} Muvaffaqiyatli yakunlandi: draftId=${result.draftId}, ish raqami=${result.caseNumber || '—'}`);
      } else {
        summary.failed.push({ id: ac.id, clientName: ac.clientName, error: result.error || 'Noma\'lum xatolik' });
        console.error(`❌ ${caseIndexStr} Xatolik: ${result.error}`);
      }
    } catch (e: any) {
      summary.failed.push({ id: ac.id, clientName: ac.clientName, error: e.message });
      console.error(`❌ ${caseIndexStr} Istisno: ${e.message}`);
    }

    // Keyingi ishgacha rate limit kutish vaqti (oxirgi ish bo'lmasa)
    if (idx < targetCases.length - 1) {
      console.log(`⏳ Rate-limit himoyasi: keyingi ishgacha ${delaySec} soniya kutilmoqda...`);
      await sleep(delaySec * 1000);
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n======================================================`);
  console.log(`YAKUNIY HISOBOT (BATCH SUMMARY):`);
  console.log(`Jami ko'rib chiqildi : ${summary.total} ta`);
  console.log(`Muvaffaqiyatli       : ${summary.succeeded.length} ta`);
  console.log(`Xatolik yuz berdi    : ${summary.failed.length} ta`);
  console.log(`Sarflangan vaqt      : ${durationSec} soniya`);
  console.log(`======================================================\n`);

  if (summary.succeeded.length > 0) {
    console.log('Muvaffaqiyatli topshirilgan ishlar:');
    summary.succeeded.forEach((s, i) => {
      console.log(`  ${i + 1}. Case #${s.id} (${s.clientName}) -> Raqam: ${s.caseNumber || s.draftId}`);
    });
  }

  if (summary.failed.length > 0) {
    console.log('\nXatolik yuz bergan ishlar:');
    summary.failed.forEach((f, i) => {
      console.log(`  ${i + 1}. Case #${f.id} (${f.clientName}) -> Sabab: ${f.error}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Bosh xatolik:', e);
  await prisma.$disconnect();
  process.exit(1);
});
