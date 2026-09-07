// cabinet-api-skeleton/find-claimants.ts
// FAQAT O'QISH: har firmaning ADOLAT da'vogar (claimant) GUID'ini topadi.
//
// Ikki manba sinaladi:
//   1. GET /api/cabinet/user/entities — foydalanuvchi nomidan ish yurita oladigan tashkilotlar
//      (wizarddagi «Da'vogar» ro'yxatining manbai)
//   2. mavjud qoralamalardagi details.createApplication.claimant (zaxira yo'l)
//
// Hech narsa yozmaydi va yubormaydi. Ishga tushirish:
//   npx tsx cabinet-api-skeleton/find-claimants.ts
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { prisma } from '../src/lib/db';
import { getStoredCabinetSession } from '../src/lib/cabinet/session';
import { cabinetFetch, listDrafts } from '../src/lib/cabinet/api';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (j: any): any[] => (Array.isArray(j) ? j : j?.content ?? j?.data ?? []);

async function main() {
  const firms = await prisma.firm.findMany({
    select: { id: true, shortName: true, stir: true, cabinetClaimantId: true },
    orderBy: { id: 'asc' },
  });

  for (const f of firms) {
    const account = (f.stir || '').replace(/\D/g, '');
    if (!account) continue;

    let session;
    try {
      session = await getStoredCabinetSession(account);
    } catch {
      continue; // sessiyasi yo'q firmalarni o'tkazib yuboramiz
    }

    console.log(`\n=== ${f.shortName} (${account}) ===`);
    console.log(`    bazada: ${f.cabinetClaimantId ?? '(bo\'sh)'}`);

    // 1) user/entities
    try {
      const r = await cabinetFetch(session, '/api/cabinet/user/entities');
      const list = rows(r.json);
      console.log(`    user/entities: status ${r.status}, ${list.length} ta yozuv`);
      for (const e of list.slice(0, 6)) {
        const id = e?.id ?? e?.entity_id ?? e?.entity?.id;
        const name = e?.name ?? e?.org_name ?? e?.entity?.name ?? e?.names?.uz ?? '';
        const type = e?.entity_type ?? e?.type ?? '';
        console.log(`      - ${id}  ${type}  ${String(name).slice(0, 60)}`);
      }
    } catch (e: any) {
      console.log(`    user/entities: XATO — ${e.message?.slice(0, 120)}`);
    }

    // 2) zaxira: mavjud qoralamalardan
    try {
      const d = await listDrafts(session);
      let found: string | null = null;
      for (const row of rows(d.json)) {
        const ca = row?.details?.createApplication;
        if (ca?.claimant && GUID.test(String(ca.claimant))) { found = String(ca.claimant); break; }
      }
      console.log(`    qoralamalardan: ${found ?? '(topilmadi)'}`);
    } catch (e: any) {
      console.log(`    qoralamalardan: XATO — ${e.message?.slice(0, 120)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
