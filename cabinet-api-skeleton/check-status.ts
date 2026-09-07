// cabinet-api-skeleton/check-status.ts
// FAQAT O'QISH: bugun yaratilgan ishlar ADOLAT'da qanday holatda ekanini aniqlaydi.
//
// Asosiy savol: ular SUDGA TOPSHIRILGANMI (rasmiy da'vo) yoki shunchaki YARATILGANmi
// (kabinetda turibdi, hali yuborilmagan)? Bazada caseNumber null — shuning uchun portalning
// o'zidan so'raymiz.
//
//   npx tsx cabinet-api-skeleton/check-status.ts
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch } from '../src/lib/cabinet/api';

const rows = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);

async function main() {
  const cases = await prisma.arizaCase.findMany({
    where: { stage: 'COURT_SUBMITTED', courtCaseId: { not: null } },
    select: { id: true, clientName: true, courtCaseId: true, firm: { select: { stir: true, shortName: true } } },
    take: 5,
  });
  if (!cases.length) { console.log('COURT_SUBMITTED ish topilmadi'); return; }

  const account = (cases[0].firm.stir || '').replace(/\D/g, '');
  const session = await getStoredCabinetSession(account);
  console.log(`Firma: ${cases[0].firm.shortName} (${account})\n`);

  // 1) Portaldagi ISHLAR ro'yxati — bizning id'lar shu yerda bormi va qanday statusda?
  const list = await cabinetFetch(session, '/api/cabinet/case/civil/all-cases');
  const all = rows(list.json);
  console.log(`Portaldagi civil/all-cases: status ${list.status}, ${all.length} ta yozuv`);
  if (all[0]) console.log('Namuna maydonlari:', Object.keys(all[0]).slice(0, 18).join(', '), '\n');

  const byId = new Map<string, any>();
  for (const r of all) {
    for (const k of ['id', 'case_id', 'claim_id']) if (r?.[k]) byId.set(String(r[k]), r);
  }

  for (const c of cases) {
    const hit = byId.get(String(c.courtCaseId));
    console.log(`--- #${c.id} ${c.clientName}`);
    console.log(`    courtCaseId : ${c.courtCaseId}`);
    if (hit) {
      console.log(`    PORTALDA BOR: status=${hit.current_status ?? hit.status ?? '?'} ` +
        `case_number=${hit.case_number ?? '(yo\'q)'} registry=${hit.registry_number ?? '-'}`);
    } else {
      console.log('    portal ro\'yxatida TOPILMADI (ehtimol hali topshirilmagan qoralama/ish)');
    }
  }

  // 2) Qoralamalar ro'yxatida turibdimi?
  const drafts = await cabinetFetch(session, '/api/cabinet/pub-user-draft-cases/list');
  console.log(`\nQoralamalar: ${rows(drafts.json).length} ta`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
