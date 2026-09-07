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
  accepted: number;  // qabul qilingani
  missing: number;   // portalda topilmagani (holati noma'lum — tegilmaydi)
}

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
    select: { id: true, courtCaseId: true, meta: true },
  });
  const res: OutcomeSyncResult = {
    firm: firm.shortName, checked: cases.length, matched: 0, declined: 0, accepted: 0, missing: 0,
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
    if (!hit) { res.missing++; continue; }
    res.matched++;
    const status = String(hit.current_status ?? hit.status ?? '').toUpperCase();
    const meta = (c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta))
      ? { ...(c.meta as Record<string, unknown>) } : {};

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
      await prisma.courtQueueItem.updateMany({
        where: { caseId: c.id },
        data: {
          state: 'FAILED',
          lastError: 'Sud rad etdi (DECLINED). Sabab odatda javobgar JShShIR ma\'lumotlari — tuzatilgach qayta yuboriladi.',
          finishedAt: new Date(),
        },
      });
      res.declined++;
    } else {
      const caseNumber = hit.case_number ?? hit.registry_number ?? null;
      if (caseNumber && meta.caseNumber !== caseNumber) {
        meta.caseNumber = caseNumber;
        await prisma.arizaCase.update({ where: { id: c.id }, data: { meta: meta as any } });
      }
      res.accepted++;
    }
  }

  return res;
}
