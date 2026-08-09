# Manzillarni o'zbek lotinga o'girish — Implementation Plan

**Goal:** Portfeldagi ruscha/transliteratsiya manzillarni toza o'zbek lotin manzilga aylantirish (region + tuman + MFY/ko'cha/uy) va bazada saqlash.

**Architecture:** Tashqi fayl importi SHART EMAS. Portfelning `raw` ustunida allaqachon `distr_name` (o'zbek kirill tuman nomi, 100% to'liq) va `regionName` (14 region) bor. O'girish koddagi deterministik lug'at orqali: 14 region + 204 tuman → o'zbek lotin (aniq lug'at, mexanik translit emas, chunki kirill soddalashtirilgan ruscha harflar bilan). Manzil dumi (MFY/ko'cha/uy) `post_address`dan token-tozalash bilan olinadi. Yangi `postAddressUz` ustuni + mavjud 159 860 qatorga bir martalik backfill + import'da avtomatik hisoblash.

**Tech Stack:** Prisma 5.22 / MySQL 8, TypeScript, mavjud import va ariza pipeline.

## Global Constraints
- DB paroli faqat git-ignored `.env`da; hech qachon commit qilinmaydi.
- Dev serverni men ishga tushirmayman — foydalanuvchi o'zi tekshiradi.
- `qrcode-pro` va E-IMZO'ga tegilmaydi.
- Region+tuman lug'ati 0 xato bilan qoplangan (validatsiya qilindi).

---

### Task 1: `src/core/address.ts` — sof normalizator moduli
**Files:** Create `src/core/address.ts`, Test `src/core/address.test.ts`

- `REGION` map (14): `regionName` (kirill, Latin-H/I normallashtirilgan) → "Namangan viloyati" / "Toshkent shahri" / "Qoraqalpogʻiston Respublikasi" ...
- `DISTRICT` map (204): tuman bazasi (kirill) → o'zbek lotin; `ТУМАНИ`→` tumani`, `ШАХРИ`→` shahri` qo'shimchasi.
- `cleanTail(post)`: kirill/`?` dumini tashlaydi; `RAYON/RAION` markeridan keyingi qismni oladi; `UL/GOROD` tashlab, `MSG/MFI/MAX/MAHALLA→MFY`, `MAVZE/MASSIV→mavze`, `KUCHASI→koʻchasi`, `DOM/UY/D + N→N-uy`, `KV/XONADON + N→N-xonadon`, shovqin (`RS,R/S,B/N,R-SIZ,DIERI`) tashlanadi, Title Case.
- `normalizeAddress(regionName, distrName, postAddress)`: `[region, district, tail].filter(Boolean).join(', ')`.
- Testlar: 15+ real satr (jilo: `MAVZE`≠MFY, `R-SIZ` tashlanadi), 0-unmapped coverage tekshiruvi.

### Task 2: Schema — `postAddressUz` ustuni
**Files:** Modify `prisma/schema.prisma` (Loan modeliga `postAddressUz String? @db.Text`), `prisma db push`.

### Task 3: Import integratsiyasi
**Files:** Modify `src/core/portfolio.ts` (`LoanInput`ga `postAddressUz`), import yozuvchi joy.
- `mapRowToLoan`da `postAddressUz = normalizeAddress(regionName, raw.distr_name, postAddress)`.

### Task 4: Backfill skripti (bir martalik, 159k)
**Files:** Create `scripts/backfill-address-uz.ts` (yoki `src/scripts/`).
- PK bo'yicha **partiyalab** (id-range, ~1000 tadan, ketma-ket bitta ulanish) — to'liq-skan JAM'ini oldini oladi.
- Har partiya: `SELECT id, regionName, postAddress, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.distr_name'))` → `normalizeAddress` → `UPDATE ... SET postAddressUz`.
- Progress log; qayta ishga tushirsa davom etadigan (id kursori).

### Task 5: Ariza + UI'da ishlatish
**Files:** Modify `src/core/ariza.ts` (`personAddress = postAddressUz ?? postAddress`), `src/app/(app)/s/[date]/p/[pinfl]/page.tsx` va Mijozlar ko'rinishida yangi ustunni ko'rsatish.

### Task 6: Sifatni tekshirish
- Backfilldan keyin 30+ tasodifiy qatorni ko'rish; jilolarni to'g'rilash.

---

## Ochiq masala
- MySQL hozir mening og'ir diagnostika so'rovlarim tufayli osilib qolgan (KILL ta'sir qilmayapti). Backfilldan oldin MySQL xizmatini qayta ishga tushirish kerak.
