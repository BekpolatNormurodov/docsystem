// cabinet-api-skeleton/dry-run.ts
// Xavfsiz sinov skripti: birorta real sud ishini buzmasdan, qoralamani yaratadi,
// tekshiradi va oxirida o'chirib tashlaydi (send-to-court chaqirmaydi).

import { CabinetSubmitEngine } from './submitter';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

async function runDryTest() {
  const token = process.env.CABINET_TOKEN || 'SAMPLE_X_AUTH_TOKEN';
  const firmStir = process.env.FIRM_STIR || '311976765';

  const engine = new CabinetSubmitEngine({
    token,
    account: firmStir,
    orgName: 'BRIGHT FUTURE FINANCING',
  });

  const sampleCase: SourceCaseData = {
    firm: {
      name: '"BRIGHT FUTURE FINANCING MIKROMOLIYA TASHKILOTI" MCHJ MMT',
      shortName: 'BRIGHT FUTURE FINANCING',
      stir: firmStir,
      address: 'Toshkent sh., Olmazor tumani, Sag\'bon ko\'chasi 30-berk 7/1',
      bankAccount: '20216000207212842001',
      phone: '998993058435',
      director: 'BOYNAZAROV AKRAM ANVAROVICH',
    },
    debtor: {
      pinfl: '33007962530011',
      fullName: 'AKRAMOV DANTES OTABEK O\'G\'LI',
      passportSn: 'AE6149348',
      birthDate: '1996-07-30',
      address: 'Toshkent sh., Uchtepa tumani, Ibn Sino MFY',
      phone: '998901234567',
    },
    debt: {
      principal: 5000000,
      interest: 850000,
      penalty: 150000,
      total: 6000000,
    },
    receiptNumber: '262196086404',
  };

  const sampleFiles: CaseFileToUpload[] = [
    {
      kind: 'ARIZA',
      fileName: 'Ariza_AKRAMOV_DANTES.pdf',
      buffer: Buffer.from('%PDF-1.4 Mock Ariza Content...'),
    },
    {
      kind: 'TALABNOMA',
      fileName: 'Talabnoma_AKRAMOV_DANTES.pdf',
      buffer: Buffer.from('%PDF-1.4 Mock Talabnoma Content...'),
    },
    {
      kind: 'TALABNOMA_CHECK',
      fileName: 'Check_UZPOST_12345.pdf',
      buffer: Buffer.from('%PDF-1.4 Mock Uzpost Check...'),
    },
  ];

  console.log('--- cabinet.sud.uz API Sinov Rejimi (Dry Run) Boshlandi ---');
  const result = await engine.submitCase(sampleCase, sampleFiles, { dryRun: true });
  console.log('Natija:', result);
}

// npx tsx cabinet-api-skeleton/dry-run.ts
if (require.main === module) {
  runDryTest().catch(console.error);
}
