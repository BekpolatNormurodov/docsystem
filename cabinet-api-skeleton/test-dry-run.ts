// cabinet-api-skeleton/test-dry-run.ts
// Yangi (2026-09-06 tuzatilgan) CabinetSubmitEngine'ni HAQIQIY cabinet.sud.uz API'da sinaydi —
// MySQL'ga tegmasdan (case_3505.json'dagi DAVRONOV ma'lumotlari qo'lda kiritilgan). dryRun:true —
// draft yaratiladi, to'ldiriladi, TEKSHIRILADI, so'ng O'ZI o'chiriladi. send-to-court'ga
// UMUMAN yetilmaydi (submitter.ts shunday yozilgan).
//
//   npx tsx cabinet-api-skeleton/test-dry-run.ts

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { CabinetSubmitEngine } from './submitter';
import { CABINET_COURT_IDS, CABINET_REGION_IDS } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

const TOKEN = '68fb58e0-6e33-45fb-9a76-8e85adde1902';
const CLAIMANT_ID_BRIGHT = 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a';

async function main() {
  const caseData: SourceCaseData = {
    courtId: CABINET_COURT_IDS.YUQORICHIRCHIQ_CIVIL,
    regionId: CABINET_REGION_IDS.TOSHKENT_VILOYATI,
    claimantId: CLAIMANT_ID_BRIGHT,
    firm: { stir: '311976765' },
    debtor: {
      pinfl: '52606016180045',
      fullName: 'DAVRONOV XURSHED XUSENOVICH',
      gender: 'MALE',
    },
    debt: {
      principal: 36645901, interest: 0, penalty: 0, fine: 0,
      moralDamage: 0, materialDamage: 0, lostProfit: 0, prepaidExpense: 0,
      total: 36645901,
    },
  };
  const files: CaseFileToUpload[] = []; // fayl yuklash bu sinovda o'tkazib yuboriladi (alohida tekshiriladi)

  const engine = new CabinetSubmitEngine({ token: TOKEN, account: '311976765', orgName: 'BRIGHT FUTURE FINANCING' });
  console.log('🔍 CabinetSubmitEngine.submitCase({dryRun:true}) — YANGI kod, HAQIQIY API...\n');
  const result = await engine.submitCase(caseData, files, { dryRun: false });

  console.log('\n======================================================');
  console.log(result.ok ? '✅ MUVAFFAQIYAT' : '❌ XATO');
  console.log(JSON.stringify(result, null, 1));
  console.log('======================================================');
}
main().catch((e) => { console.error('Fatal:', e); process.exitCode = 1; });
