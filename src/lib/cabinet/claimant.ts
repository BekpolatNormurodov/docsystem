// cabinet.sud.uz (ADOLAT) DA'VOGAR (claimant) GUID'ini aniqlash.
//
// NEGA bu alohida modul: claimant GUID da'vo KIM nomidan ochilishini belgilaydi. Noto'g'ri
// qiymat = kreditor bo'lmagan yuridik shaxs nomidan sudga da'vo, va bu qaytarib bo'lmaydi.
// Ilgari bu qiymat kodda qattiq yozilgan lug'atda edi va faqat BRIGHT xaritalangandi —
// qolgan 8 firma JIMGINA BRIGHT'ning GUID'iga tushardi. Endi:
//   1) Firm.cabinetClaimantId — bazadan (Firmalar bo'limidan kiritiladi, deploy kerak emas)
//   2) topilmasa — portaldan avtomatik aniqlashga urinish (firmaning mavjud qoralamalaridan)
//   3) u ham bo'lmasa — ATAYIN xato: taxmin qilib yubormaymiz.
import { prisma } from '../db';
import { listDrafts } from './api';
import type { CabinetSession } from './oneid';

/** Da'vogar aniqlanmaganda tashlanadi — chaqiruvchi buni operatorga ko'rsatadigan xabarga aylantiradi. */
export class ClaimantUnknownError extends Error {
  constructor(firmName: string) {
    super(
      `${firmName} uchun ADOLAT da'vogar (claimant) ID belgilanmagan. ` +
      `Firmalar → ${firmName} → «ADOLAT da'vogar ID» maydoniga yozing, ` +
      `yoki shu firma kaliti bilan ADOLAT'da bitta qoralama yarating — tizim keyingi safar o'zi topadi.`,
    );
    this.name = 'ClaimantUnknownError';
  }
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Portal javobidagi qoralamalar ro'yxatidan ORGANIZATION da'vogar GUID'ini ajratib olish. */
function claimantFromDrafts(json: unknown): string | null {
  const rows: any[] = Array.isArray(json) ? json : ((json as any)?.content ?? (json as any)?.data ?? []);
  if (!Array.isArray(rows)) return null;
  // Eng yangi qoralamadan boshlab qaraymiz — firma o'zgargan bo'lsa oxirgisi to'g'ri.
  for (const row of rows) {
    const ca = row?.details?.createApplication;
    if (!ca) continue;
    // FAQAT ORGANIZATION: jismoniy shaxs da'vogari (advokat o'z nomidan) bizga to'g'ri kelmaydi.
    if (ca.claimant_type && ca.claimant_type !== 'ORGANIZATION') continue;
    const id = typeof ca.claimant === 'string' ? ca.claimant.trim() : '';
    if (GUID_RE.test(id)) return id;
  }
  return null;
}

/**
 * Firma uchun claimant GUID. Bazada bo'lsa — o'sha (tarmoqqa chiqmaydi). Bo'lmasa portaldagi
 * qoralamalardan topib, BAZAGA YOZIB QO'YADI (keyingi safar so'rov ketmaydi).
 *
 * `session` berilmasa faqat bazadan o'qiydi — avtomatik aniqlash bajarilmaydi.
 */
export async function resolveClaimantId(
  firm: { id: number; shortName: string; cabinetClaimantId?: string | null },
  session?: CabinetSession,
): Promise<string> {
  const stored = firm.cabinetClaimantId?.trim();
  if (stored && GUID_RE.test(stored)) return stored;
  if (!session) throw new ClaimantUnknownError(firm.shortName);

  let found: string | null = null;
  try {
    const res = await listDrafts(session);
    if (res.ok) found = claimantFromDrafts(res.json);
  } catch {
    // Tarmoq/portal xatosi — bu yerda yutamiz: chaqiruvchi ClaimantUnknownError'ni ko'radi va
    // operator qiymatni qo'lda kiritishi mumkin. Portal bloki butun jarayonni to'xtatmasin.
  }
  if (!found) throw new ClaimantUnknownError(firm.shortName);

  await prisma.firm.update({ where: { id: firm.id }, data: { cabinetClaimantId: found } });
  console.log(`[cabinet] ${firm.shortName} da'vogar ID portaldan aniqlandi: ${found}`);
  return found;
}
