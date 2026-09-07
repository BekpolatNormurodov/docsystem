// cabinet-api-skeleton/test-dry-run.ts
// Yangi (2026-09-06 tuzatilgan) CabinetSubmitEngine'ni HAQIQIY cabinet.sud.uz API'da sinaydi —
// MySQL'ga tegmasdan (case_3505.json'dagi DAVRONOV ma'lumotlari qo'lda kiritilgan).
//
// DIQQAT: fayl nomi «test-dry-run», lekin u SUKUT BO'YICHA HAQIQIY yuborish rejimida
// ishlaydi. Ilgari yuqoridagi izoh «dryRun:true — draft o'zi o'chiriladi» derdi, kod esa
// `{ dryRun: false }` uzatardi: ya'ni izoh yolg'on edi va skript real odamga qarshi rasmiy
// da'vo ochishi mumkin edi. Endi rejim ANIQ va DEFAULT — quruq sinov:
//   DRY=1 (yoki umuman berilmasa) — qoralama yaratiladi, tekshiriladi, O'ZI o'chiriladi;
//   DRY=0                          — HAQIQIY da'vo sudga topshiriladi.
//
//   CABINET_TOKEN=<token> npx tsx cabinet-api-skeleton/test-dry-run.ts

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { CabinetSubmitEngine } from './submitter';
import { CABINET_COURT_IDS, CABINET_REGION_IDS } from './constants';
import type { SourceCaseData } from './builder';
import type { CaseFileToUpload } from './uploader';

// SESSIYA TOKENI HECH QACHON KODDA TURMAYDI.
//
// 2026-09-07: shu qatorda BRIGHT'ning HAQIQIY cabinet.sud.uz sessiya tokeni qattiq yozilgan
// va OMMAVIY git repozitoriyasiga push qilingan edi. Cabinet tokenida server e'lon qilgan
// amal qilish muddati yo'q (`ExternalSession.expiresAt = null`, tiriklik faqat /user/get
// bilan tekshiriladi) — ya'ni uni ko'rgan har kim BRIGHT nomidan qoralama ochib, hujjat
// yuklab, sudga da'vo yuborishi mumkin edi. Dockerfile.worker bu faylni image'ga
// ko'chirmaydi, lekin sizib chiqish joyi image emas, GIT edi.
const TOKEN = process.env.CABINET_TOKEN;
const CLAIMANT_ID_BRIGHT = process.env.CABINET_CLAIMANT_ID ?? 'a9c49a63-5b0b-48c6-b2fb-48db85dd6f5a';

if (!TOKEN) {
  console.error(
    'CABINET_TOKEN berilmagan. Bu skript HAQIQIY portalga chiqadi, shuning uchun token\n' +
    'faqat muhit o\'zgaruvchisidan olinadi:\n' +
    '  CABINET_TOKEN=<sessiya-token> npx tsx cabinet-api-skeleton/test-dry-run.ts',
  );
  process.exit(1);
}

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
  // Sukut bo'yicha QURUQ sinov. Haqiqiy yuborish faqat ATAYIN `DRY=0` bilan.
  const dryRun = process.env.DRY !== '0';
  if (!dryRun) console.log('⚠ DRY=0 — bu HAQIQIY da\'vo. Portal qabul qilsa, ish rasman ochiladi.\n');
  const result = await engine.submitCase(caseData, files, { dryRun });

  console.log('\n======================================================');
  console.log(result.ok ? '✅ MUVAFFAQIYAT' : '❌ XATO');
  console.log(JSON.stringify(result, null, 1));
  console.log('======================================================');
}
main().catch((e) => { console.error('Fatal:', e); process.exitCode = 1; });
