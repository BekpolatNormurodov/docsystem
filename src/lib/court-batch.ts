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
