// Sudga yuborish partiyasining hajmi — SERVER va CLIENT ikkalasi ishlatadigan yagona manba.
//
// Nega alohida fayl: bu doimiy court-ready.ts da turgan edi, u esa `prisma` ni import qiladi.
// CourtManager.tsx — client komponent; server modulini import qilish Prisma'ni brauzer
// bundle'iga tortib kirishi mumkin. Shuning uchun doimiy hech narsa import qilmaydigan
// alohida modulda.
//
// Chegara sudning KUNLIK limitidan (Court.dailyQuota) alohida: bu bitta partiyaning hajmi,
// kunlik limit esa sud bo'yicha hisoblanadi va allokatsiyada qo'llanadi.
export const MAX_COURT_BATCH = 200;

/**
 * ZIP eksporti uchun chegara — sudga yuborishdan ALOHIDA va ancha katta.
 *
 * Sabab: MAX_COURT_BATCH portalga yuboriladigan partiya hajmi (tashqi tizimni urib
 * qo'ymaslik uchun). ZIP esa portalga BITTA ham so'rov yubormaydi — u faqat serverda PDF
 * render qiladi. Shuning uchun operator «hammasi» deganda haqiqatan hammasini olishi kerak:
 * 767 ta tayyor mijozni 200 tadan 4 marta yuklab olish ma'nosiz.
 *
 * Yuqori chegara faqat xotira/vaqt uchun: 1000 ta mijoz ≈ 1000 papka, chromium 16 ta
 * parallel render qiladi.
 */
export const MAX_ZIP_BATCH = 1000;
