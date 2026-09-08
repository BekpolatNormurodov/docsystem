// «Batafsil» ro'yxatidagi tab sonlarini hisoblash — SERVER va BRAUZER uchun YAGONA qoida.
//
// NEGA ALOHIDA FAYL: bu qoida ikki joyda kerak va ikkalasi ham uni o'zicha yozgan edi —
// server `firmReadyClients` ichida, brauzer esa `CourtManager` ichida optimistik
// yangilanish uchun (bitta qator o'zgarganda butun ro'yxatni qayta yuklamaslik kerak).
// Ikkita nusxa demak — qoida o'zgarganda bittasi eskirib qoladi va operator ikki xil son
// ko'radi. Aynan shu 2026-09-08 kod ko'rigida qayd etilgan («kop joyda sonlar almashishi»).
//
// Fayl `prisma` ni import QILMAYDI: `CourtManager` client-komponent, unga server modulini
// tortish Prisma'ni brauzer bundle'iga olib kirardi (`court-batch.ts` bilan bir xil sabab).

/** Sanoq uchun kerak bo'ladigan yagona narsa — qatordagi bayroqlar. */
export interface CountableRow {
  ready: boolean;
  exported: boolean;
  submitted: boolean;
  draft: boolean;
  draftReady?: boolean;
  queued?: boolean;
  sendable: boolean;
}

export interface ClientReadyCounts {
  all: number;
  sendable: number;
  queued: number;
  draftReady: number;
  draft: number;
  ready: number;
  exported: number;
  submitted: number;
  notready: number;
}

export const emptyClientCounts = (): ClientReadyCounts => ({
  all: 0, sendable: 0, queued: 0, draftReady: 0, draft: 0, ready: 0, exported: 0, submitted: 0, notready: 0,
});

/**
 * Tab sonlari.
 *
 * MUHIM QOIDA: «Chiqarilgan» (ZIP olingan) va «Sudda» BIR-BIRINI ISTISNO QILADI. Sudga
 * ketgan ish «Chiqarilgan» sanog'ida turmaydi — aks holda bitta ish ikki tabda ko'rinadi
 * va yig'indisi jamidan oshib ketadi (2026-09-07 holati).
 */
export function tallyClientCounts(rows: CountableRow[]): ClientReadyCounts {
  const c = emptyClientCounts();
  for (const r of rows) {
    c.all++;
    if (r.sendable) c.sendable++;
    if (r.queued) c.queued++;
    if (r.draftReady) c.draftReady++;
    if (r.draft) c.draft++;
    if (r.ready) c.ready++;
    if (r.submitted) c.submitted++;
    else if (r.exported) c.exported++;
    if (!r.ready) c.notready++;
  }
  return c;
}
