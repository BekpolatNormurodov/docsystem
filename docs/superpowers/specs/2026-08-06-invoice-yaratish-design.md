# «Invoice yaratish» — Billing.sud.uz avtomatlashtirilgan kvitansiya moduli

**Sana:** 2026-08-06
**Loyiha:** docsystem

## Maqsad

Docsystem ichida sidebar orqali `billing.sud.uz` sud to'lov tizimida ko'plab
kvitansiya (invoice) yaratishni avtomatlashtirish: forma maydonlarini avtomat
to'ldirish, PDF va invoice raqamini tizimga yig'ish. Foydalanuvchi faqat
anti-bot tasdiqni («Robot emasman») va «Yaratish» tugmasini o'zi bosadi.

## Qamrov chegarasi (MUHIM)

`billing.sud.uz` formasida **«Robot emasman»** — bu anti-bot (bot-aniqlash)
himoyasi. Avtomatlashtirish uni **AYLANIB O'TMAYDI va o'zi BOSMAYDI**. Har bir
tabda checkbox va yakuniy «Yaratish» tugmasini **foydalanuvchi qo'lda** bosadi.
Modul faqat matn/dropdown maydonlarini to'ldiradi va natijani (PDF + raqam)
yig'adi. Bu chegara loyihaning barcha qismlarida saqlanadi.

## Foydalanuvchi oqimi

```
Foydalanuvchi: firma + soni + to'lov turi + summa tanlaydi → «Boshlash»
  ↓
Server Playwright orqali ko'rinadigan (headed) Chrome ochadi, N ta tab
  ↓
Har tab: /create-receipt sahifasiga o'tadi, formani avtomat to'ldiradi
   (Yuridik shaxs, tashkilot nomi, STIR, manzil modal: viloyat/tuman/ko'cha,
    sud turi, sud hududi, sud, to'lov turi, summa)
  ↓
⏸ «Robot emasman» dan oldin TO'XTAYDI
  ↓
Foydalanuvchi: har tabda «Robot emasman» + «Yaratish» bosadi   ← YAGONA qo'lda qadam
  ↓
Sahifa /invoice/{raqam} ga o'tadi. Server buni URL o'zgarishidan aniqlaydi:
     • invoice raqamini URL/sahifadan oladi
     • kvitansiya PDF havolasini topib yuklab oladi
     • InvoiceRecord sifatida bazaga saqlaydi
  ↓
Appda «Yaratilgan invoyslar» ro'yxati yangilanadi
```

## Arxitektura

- **Frontend:** Next.js App Router sahifasi `/invoyslar` (yoki `/invoice-create`),
  sidebar NAV ga yangi punkt «Invoice yaratish».
- **Boshqaruv:** Server-side Playwright (`playwright` paketi + Chromium) — Node
  jarayonida headed Chrome kontekstini ochadi va N ta sahifa (tab) bilan
  ishlaydi. Docsystem lokal ishlaydi, shuning uchun headed brauzer mos.
- **Holat kuzatuvi:** Har tab uchun holat mashinasi:
  `FILLING → WAITING_HUMAN (captcha) → SUBMITTED → CAPTURED | FAILED`.
  Server har tabning URL'ini kuzatadi; `/invoice/` ga o'tsa — natijani yig'adi.
- **Saqlash:** Yuklab olingan PDF fayl tizimda saqlanadi (mavjud export ZIP
  papkasi yonida yoki `storage/invoices/`), yozuv `InvoiceRecord` jadvalida.

## Ma'lumotlar modeli

### `Firm` modeliga qo'shiladigan maydonlar (manzil komponentlari)

Billing forma manzilni alohida so'raydi (Viloyat dropdown / Tuman dropdown /
ko'cha matni), shuning uchun `Firm`ga:

- `region String?` — viloyat (billing dropdown ko'rinadigan matni, masalan
  «Тошкент шаҳар»)
- `district String?` — tuman («Олмазор тумани»)
- `addressLine String?` — ko'cha/uy («Gurushariq MFY, Sag'bon kochasi 30-berk 7/1»)

Mavjud `address` (bitta matn) qoladi; yangi 3 maydon avtomatlashtirishga xizmat
qiladi. Firma tahrirlash formasiga (FirmForm) shu 3 maydon qo'shiladi.

### Yangi `InvoiceRecord` modeli

```prisma
model InvoiceRecord {
  id          Int      @id @default(autoincrement())
  invoiceNo   String   @unique          // billing.sud.uz invoice raqami
  firmId      Int
  firm        Firm     @relation(fields: [firmId], references: [id])
  paymentType String                    // to'lov turi (masalan "Почта харажатлари")
  amount      Decimal  @db.Decimal(20, 2)
  courtType   String                    // sud turi
  courtRegion String                    // sud hududi
  court       String                    // sud nomi
  pdfPath     String?                   // saqlangan PDF nisbiy yo'li
  status      String   @default("CREATED") // CREATED | FAILED
  createdAt   DateTime @default(now())
}
```

## Forma maydonlari va default qiymatlar

| Maydon | Manba / default | Tanlanadi? |
|---|---|---|
| Shaxs turi | «Yuridik shaxs» (qat'iy) | yo'q |
| Tashkilot nomi | `firm.shortName` (yoki `legalName`) | firma orqali |
| STIR | `firm.stir` | firma orqali |
| Manzil (viloyat/tuman/ko'cha) | `firm.region` / `firm.district` / `firm.addressLine` | firma orqali |
| Soni | default **1** | ha (raqam) |
| To'lov turi | default **«Почта харажатлари»** | ha (3 ta variant) |
| Summa | default **20 600** | ha (raqam) |
| Sud turi | default «Фуқаролик ишлари бўйича» | qat'iy (v1), keyin sozlanadi |
| Sud hududi | default «Тошкент шаҳар» | qat'iy (v1) |
| Sud | default «...Учтепа туманлараро суди» | qat'iy (v1) |

**v1 eslatma:** Sud turi/hududi/sud kaskad dropdownlari billing saytida bir-biriga
bog'liq va ro'yxati katta. v1 da ular kodda qat'iy default (skриншотdagi qiymatlar)
bilan to'ldiriladi. To'liq tanlanadigan kaskad — keyingi bosqich.

## UI

Sahifa `/invoyslar`:
- Yuqorida forma karta: Firma dropdown (9 firma), Soni (default 1), To'lov turi
  dropdown, Summa input, «Boshlash» tugmasi. Sud maydonlari default ko'rsatiladi
  (read-only info sifatida).
- «Boshlash» bosilgach: har tab uchun holat ko'rsatkichi (progress) —
  «To'ldirilmoqda», «⏸ Captcha kuting — bosing», «✓ Yaratildi #NNN».
- Pastda «Yaratilgan invoyslar» jadvali: raqam, firma, to'lov turi, summa, sana,
  PDF yuklab olish tugmasi. `InvoiceRecord` dan.

## Xatoliklar

- Playwright/Chromium topilmasa: aniq xabar («Chrome o'rnatilmagan — `npx playwright
  install chromium` ishga tushiring»).
- Tab captcha'da uzoq kutsa (masalan >5 daqiqa foydalanuvchi bosmasa): tab
  `WAITING_HUMAN` holatida qoladi, xato emas — foydalanuvchi qachon xohlasa bosadi.
- Submit'dan keyin `/invoice/` ochilmasa (validatsiya xatosi): tab `FAILED`,
  sabab ko'rsatiladi, boshqa tablarga ta'sir qilmaydi.
- PDF yuklab olishда xato: `InvoiceRecord` `CREATED` bo'lib saqlanadi (raqam bor),
  `pdfPath` null — ro'yxatda «PDF qayta yuklash» ko'rsatiladi.

## Test

- `Firm` migratsiyasi: yangi 3 maydon qo'shiladi, mavjud ma'lumot buzilmaydi.
- Forma → payload: firma + tanlovlardan billing maydonlar to'plami to'g'ri yig'iladi
  (unit test, Playwright'siz).
- Playwright fill oqimi: bitta tabda formani to'ldirib, captcha'dan oldin
  to'xtashini tekshirish (billing sayti mavjudligiga bog'liq — qo'lda/integration).
- `InvoiceRecord` saqlash: raqam + PDF yo'li yozilishini tekshirish.

## Qamrovga KIRMAYDI (v1)

- Captcha'ni avtomat bosish (qat'iy chegara — hech qachon).
- Sud kaskad dropdownlarini to'liq tanlanadigan qilish.
- Bir vaqtda 10 tadan ko'p tab (v1: sozlanadigan, default ~10 gacha).
- To'lov holatini (to'landi/to'lanmadi) kuzatish.
