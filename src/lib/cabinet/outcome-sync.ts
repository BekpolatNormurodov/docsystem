// Sudga yuborilgan ishlarning HAQIQIY natijasini ADOLAT'dan olib, bazaga qaytaradi.
//
// NEGA KERAK: biz ishni yuborgach `stage = COURT_SUBMITTED` deb belgilaymiz va shu bilan
// tamom — sud uni RAD ETSA ham bazada «sudda» bo'lib qolaveradi. 2026-09-07 da aynan shunday
// bo'ldi: URBAN bo'yicha ketgan 41 ta ishning 34 tasi ADOLAT'da DECLINED bo'lgan
// («Жавобгар ЖШШИР маълумотлари тўлиқ киритилмаган»), lekin bazada hammasi «yuborilgan»
// bo'lib turardi. Operator buni ko'rmaydi va ishlar abadiy osilib qoladi.
//
// Bu modul portaldan statusni o'qib:
//   • DECLINED  -> stage COURT_RETURNED + eksport belgilari tozalanadi, ya'ni ish QAYTA
//     yuboriladigan bo'ladi (court-ready.ts: COURT_RETURNED ataylab SENT_STAGES da emas);
//   • qabul qilingan -> sud ish raqami saqlanadi.
import { prisma } from '../db';
import { getStoredCabinetSession } from './session';
import { cabinetFetch } from './api';

const asRows = (j: unknown): any[] =>
  Array.isArray(j) ? j : ((j as any)?.content ?? (j as any)?.data ?? []);

/** Portal ro'yxatidagi yozuvdan bizga kerakli id'larni yig'ish (nomlar turlicha bo'lishi mumkin). */
function idsOf(row: any): string[] {
  return ['id', 'case_id', 'claim_id']
    .map((k) => row?.[k])
    .filter(Boolean)
    .map(String);
}

export interface OutcomeSyncResult {
  firm: string;
  checked: number;   // bazada «yuborilgan» deb turgan ishlar
  matched: number;   // portalda topilgani
  declined: number;  // rad etilgani (qayta yuborishga qaytarildi)
  accepted: number;  // sud QABUL QILGAN (ro'yxatga olingan / ko'rilmoqda / qaror chiqqan)
  /** Portalda bor, lekin SUDGA BERILMAGAN qoralama (CREATED/DRAFT) — «qabul» EMAS. */
  notFiled: number;
  /** Bazada «yuborilgan», portal ro'yxatida esa YO'Q — id mos kelmayapti, tekshirish kerak. */
  missing: number;
  /** Bosqichi «yuborilgan», lekin portal id'si umuman yozilmagan — solishtirib bo'lmaydi. */
  noPortalId: number;
}

/**
 * Portal holati → bizning bosqich.
 *
 * NEGA KERAK: ilgari DECLINED'dan boshqa HAMMA holat bitta `else` shoxida «qabul» deb
 * sanalardi — shu jumladan CREATED, ya'ni SUDGA BERILMAGAN qoralama (2026-09-08 da
 * BRIGHT'da bunday 144 ta yozuv bor edi). Operatorga «qabul qilindi» deyilar, aslida
 * hech narsa berilmagan edi. Bundan tashqari ish REGISTER → IN_PROCESS → DECIDED →
 * FINISHED bo'lib borsa ham bazada bosqich O'ZGARMAS edi, ya'ni «sudga topshirilgan»dan
 * keyin hech narsa ko'rinmasdi — operator «qabul qilinsa bilmayapman» deganining sababi.
 */
const PORTAL_STAGE: Record<string, 'ACCEPTED' | 'NOT_FILED'> = {
  REGISTER: 'ACCEPTED',     // ro'yxatga olindi — da'vo qabul qilingan
  PENDING: 'ACCEPTED',      // ko'rib chiqish navbatida
  IN_PROCESS: 'ACCEPTED',   // ko'rilmoqda
  DECIDED: 'ACCEPTED',      // qaror chiqarilgan
  FINISHED: 'ACCEPTED',     // yakunlangan
  CREATED: 'NOT_FILED',     // qoralama — hali berilmagan
  DRAFT: 'NOT_FILED',
};

/**
 * Bitta firma bo'yicha natijalarni sinxronlaydi. Portalga ATIGI BITTA so'rov yuboradi
 * (butun ro'yxat), ya'ni tezlik chegarasiga sezilarli yuk bermaydi.
 */
export async function syncCourtOutcomes(firmId: number): Promise<OutcomeSyncResult> {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { id: true, shortName: true, stir: true },
  });
  if (!firm) throw new Error(`Firma topilmadi: ${firmId}`);

  const cases = await prisma.arizaCase.findMany({
    where: { firmId, stage: 'COURT_SUBMITTED', courtCaseId: { not: null } },
    select: { id: true, courtCaseId: true, meta: true, stage: true },
  });
  // PORTAL ID'SIZ ISHLAR — solishtirib bo'lmaydi, lekin JIM qolmasligi kerak.
  //
  // `courtCaseId` yozilmagan bo'lsa (send-to-court javobida raqam kelmagan, yoki eski
  // yozuvda «YUBORILDI» kabi matn turgan) ish portal bilan solishtirilmaydi va abadiy
  // «sudga topshirilgan» bo'lib qoladi. Ilgari u sanoqqa ham tushmasdi.
  const noPortalId = await prisma.arizaCase.count({
    where: { firmId, stage: 'COURT_SUBMITTED', courtCaseId: null },
  });

  const res: OutcomeSyncResult = {
    firm: firm.shortName, checked: cases.length, matched: 0, declined: 0, accepted: 0,
    notFiled: 0, missing: 0, noPortalId,
  };
  if (!cases.length) return res;

  const account = (firm.stir || '').replace(/\D/g, '');
  const session = await getStoredCabinetSession(account);
  const r = await cabinetFetch(session, '/api/cabinet/case/civil/all-cases');
  if (r.status !== 200) throw new Error(`Portal ro'yxati olinmadi (status ${r.status})`);

  // portal id -> yozuv
  const byId = new Map<string, any>();
  for (const row of asRows(r.json)) for (const id of idsOf(row)) byId.set(id, row);

  for (const c of cases) {
    const hit = byId.get(String(c.courtCaseId));
    if (!hit) {
      // PORTALDA TOPILMADI — sanab, tashlab yubormaymiz.
      //
      // 2026-09-08: URBAN bo'yicha 100 ta ishning 100 tasi ham shu holatda edi (saqlangan
      // id portal ro'yxatidagi hech bir yozuvga to'g'ri kelmaydi). Ular COURT_SUBMITTED
      // bo'lib qolaveradi: qayta yuborilmaydi, hech qayerda ko'rinmaydi. Endi izi
      // `meta.portalMissingAt` da qoladi va operatorga ko'rsatiladi.
      //
      // BOSQICH O'ZGARTIRILMAYDI: id mos kelmagani «da'vo yo'q» degani EMAS — portalda
      // boshqa id bilan turgan bo'lishi mumkin. Uni «qaytgan» deb belgilash IKKINCHI
      // da'voga yo'l ochardi. Bu — odam tekshiradigan holat.
      res.missing++;
      const m = (c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta))
        ? { ...(c.meta as Record<string, unknown>) } : {};
      if (!m.portalMissingAt) {
        m.portalMissingAt = new Date().toISOString();
        await prisma.arizaCase.update({ where: { id: c.id }, data: { meta: m as any } }).catch(() => {});
      }
      continue;
    }
    res.matched++;
    const status = String(hit.current_status ?? hit.status ?? '').toUpperCase();
    const meta = (c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta))
      ? { ...(c.meta as Record<string, unknown>) } : {};

    // Sud nomi portal javobida bor — xabarga qo'shamiz, operator qaysi sud rad etganini
    // darhol ko'rsin (bir firma bir nechta sudga yuboradi).
    const courtName: string | null =
      hit?.names?.uz ?? hit?.names?.uz_cyr ?? hit?.court_name ?? null;

    if (status === 'DECLINED') {
      // Ish QAYTA yuborilishi kerak: bosqichni qaytaramiz va «chiqarilgan/yuborilgan»
      // belgilarini tozalaymiz — aks holda court-ready uni «Tayyor» deb ko'rsatmaydi
      // (sendable = ready && !exported && ...).
      delete meta.exportedAt;
      delete meta.cabinetSubmittedAt;
      meta.declinedAt = new Date().toISOString();
      meta.declinedCaseId = c.courtCaseId;
      await prisma.arizaCase.update({
        where: { id: c.id },
        data: {
          stage: 'COURT_RETURNED',
          stageEnteredAt: new Date(),
          courtSentAt: null,   // kunlik limit ham qaytariladi
          courtCaseId: null,   // rad etilgan ish id'si meta'da qoladi
          meta: meta as any,
        },
      });
      // Navbat yozuvi ham qayta urinishga tayyor bo'lsin.
      // SABABNI TAXMIN QILMAYMIZ.
      //
      // Ilgari bu yerda «Sabab odatda javobgar JShShIR ma'lumotlari» deb yozilardi. Bu bir
      // marta to'g'ri bo'lgan (2026-09-07, URBAN) va shundan keyin HAR QANDAY rad etishga
      // yopishtirilib kelaverdi. 2026-09-08 da Yuqorichirchiq butunlay boshqa sabab bilan
      // rad etdi («Ҳужжатлар тартибсиз ёки тескари сақланганлиги сабабли уларни ўқиш
      // имконияти йўқ») — operator esa navbatda eski, noto'g'ri sababni o'qirdi va
      // JShShIR'ni qidirib vaqt yo'qotardi. Portal API'si sabab matnini bermaydi (tekshirildi:
      // all-cases, get-one-case-by-id, histories — hech birida yo'q), shuning uchun uni
      // ADOLAT'ning o'z sahifasidan o'qish kerakligini AYTAMIZ.
      await prisma.courtQueueItem.updateMany({
        where: { caseId: c.id },
        data: {
          state: 'FAILED',
          lastError:
            `Sud rad etdi (DECLINED)${courtName ? ` — ${courtName}` : ''}. ` +
            `Sababi ADOLAT'da: ish sahifasidagi «Rad etish sabab(lar)i» bo'limida. ` +
            `Tuzatilgach ish qayta yuboriladi.`,
          finishedAt: new Date(),
        },
      });
      res.declined++;
    } else {
      const caseNumber = hit.case_number ?? hit.registry_number ?? null;
      const kind = PORTAL_STAGE[status];

      // Portal holati HAR DOIM saqlanadi — «sudda» dan keyin nima bo'layotgani ko'rinsin.
      let changed = false;
      if (caseNumber && meta.caseNumber !== caseNumber) { meta.caseNumber = caseNumber; changed = true; }
      if (meta.portalStatus !== status) { meta.portalStatus = status; changed = true; }
      if (meta.portalMissingAt) { delete meta.portalMissingAt; changed = true; } // topildi — eski belgi ketsin

      if (kind === 'NOT_FILED') {
        // QORALAMA — «qabul» EMAS. Bosqichga tegilmaydi: ish bizda «yuborilgan» deb
        // yozilgan, portalda esa berilmagan qoralama turibdi. Buni odam tekshirishi kerak,
        // avtomatik «qaytgan» deb belgilash IKKINCHI da'voga yo'l ochardi.
        res.notFiled++;
        if (!meta.portalNotFiledAt) { meta.portalNotFiledAt = new Date().toISOString(); changed = true; }
      } else {
        res.accepted++;
        if (meta.portalNotFiledAt) { delete meta.portalNotFiledAt; changed = true; }
        // SUD QABUL QILDI → bosqich oldinga suriladi. Ilgari bosqich COURT_SUBMITTED da
        // qotib qolardi va ish sudda ro'yxatga olinganini ham, qaror chiqqanini ham hech
        // kim ko'rmasdi. COURT_ACCEPTED ham SENT_STAGES ichida — ish qayta yuborilmaydi.
        if (kind === 'ACCEPTED' && c.stage !== 'COURT_ACCEPTED') {
          await prisma.arizaCase.update({
            where: { id: c.id },
            data: { stage: 'COURT_ACCEPTED', stageEnteredAt: new Date(), meta: meta as any },
          }).catch(() => {});
          changed = false; // meta shu yerda yozildi
        }
      }
      if (changed) {
        await prisma.arizaCase.update({ where: { id: c.id }, data: { meta: meta as any } }).catch(() => {});
      }
    }
  }

  return res;
}
