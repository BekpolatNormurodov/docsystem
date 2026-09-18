import { cache } from 'react';
import { Prisma } from '@prisma/client';
import { prisma } from './db';

// React's server `cache` dedupes within one request — lekin u FAQAT RSC/Next runtime'da funksiya.
// Worker (tsx/Node) va vitest'da `cache` undefined bo'lib, module-load paytida «cache is not a
// function» bilan yiqiladi (konveyer.ts ham xuddi shu himoyani ishlatadi). Shu sabab passthrough.
const memo: typeof cache = typeof cache === 'function' ? cache : (((fn: unknown) => fn) as unknown as typeof cache);

// Firmani «nofaol» qilganda uning butun patoki (loanlar, ishlar, sud/mib/talabnoma oqimi) hamma
// bo'lim va filtr komponentlarida yashirilishi kerak. Loanlar firmага `branchCode` (= Firm.code)
// orqali, ishlar (ArizaCase) `firmId` orqali bog'langani uchun bu yerda IKKALASI ham kerak.
//
// MUHIM (xavfsizlik): hech qaysi firma nofaol bo'lmasa (hozirgi holat), bu yordamchi HAMMA joyda
// bo'sh where ({}) qaytaradi — ya'ni funksiya butunlay no-op, mavjud xatti-harakat o'zgarmaydi.
// Filtrlar faqat nofaol firma paydo bo'lgandagina qo'shiladi (`notIn: [...]`, kichik ro'yxat).
//
// `cache()` — bir server render (yoki route handler) ichida takroriy so'rovni birlashtiradi
// (firmalar jadvali ~10 qator, lekin ko'p joyda o'qiladi).

export interface FirmActivity {
  activeIds: number[];
  activeCodes: string[];
  inactiveIds: number[];
  inactiveCodes: string[];
  hasInactive: boolean;
  /** ArizaCase (va firmId li jadvallar) uchun where bo'lagi — nofaol yo'q bo'lsa {} (no-op). */
  caseWhere: Prisma.ArizaCaseWhereInput;
  /** Loan (branchCode) uchun where bo'lagi — nofaol yo'q bo'lsa {} (no-op). */
  loanWhere: Prisma.LoanWhereInput;
  isActiveId: (id: number | null | undefined) => boolean;
  isActiveCode: (code: string | null | undefined) => boolean;
}

export const firmActivity = memo(async (): Promise<FirmActivity> => {
  const firms = await prisma.firm.findMany({ select: { id: true, code: true, active: true } });
  const activeIds: number[] = [];
  const activeCodes: string[] = [];
  const inactiveIds: number[] = [];
  const inactiveCodes: string[] = [];
  for (const f of firms) {
    if (f.active) { activeIds.push(f.id); activeCodes.push(f.code); }
    else { inactiveIds.push(f.id); inactiveCodes.push(f.code); }
  }
  const hasInactive = inactiveIds.length > 0;
  const inSetId = new Set(inactiveIds);
  const inSetCode = new Set(inactiveCodes);
  return {
    activeIds, activeCodes, inactiveIds, inactiveCodes, hasInactive,
    caseWhere: hasInactive ? { firmId: { notIn: inactiveIds } } : {},
    loanWhere: hasInactive ? { branchCode: { notIn: inactiveCodes } } : {},
    isActiveId: (id) => id == null ? false : !inSetId.has(id),
    isActiveCode: (code) => code == null ? false : !inSetCode.has(code),
  };
});
