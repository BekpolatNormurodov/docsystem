// cabinet-api-skeleton/submitter.ts
// cabinet.sud.uz (ADOLAT) ga arizani HAQIQIY (2026-09-06 tasdiqlangan) draft-update oqimi
// orqali kiritish dvigateli.
//
// ESKI VERSIYA (Step 1-8, alohida draftCreate/participantAdd/saveSuit endpoint'lari) BUTUNLAY
// noto'g'ri taxminga asoslangan edi — participantAdd va draftGet LIVE sinovda 404 berdi.
// Haqiqiy oqim MUCH SODDAROQ: bitta draft yaratiladi, keyin unga 2-3 marta PUT bilan
// `details.<section>` to'ldiriladi (har PUT oldingi bo'limlarni ham qayta yuboradi — server
// merge qilmaydi, to'liq holatni saqlaydi). Fayllar mavjud (va ishlaydigan)
// src/lib/cabinet/api.ts uploadFile() bilan bir xil `file_type` header naqshi orqali yuklanadi.

import { CabinetApiClient, CabinetRequestError, type CabinetErrorKind } from './client';
import { CabinetFileUploader, type CaseFileToUpload } from './uploader';
import { CabinetPayloadBuilder, type SourceCaseData } from './builder';
import { CABINET_ENDPOINTS } from './constants';
import type { CabinetAuthSession, DraftCaseResponse, DraftDetails, UploadedCabinetFile, UploadedFileRef } from './types';

export interface SubmissionOptions {
  dryRun?: boolean; // true bo'lsa: draft yaratib to'ldiradi, TEKSHIRADI, keyin O'CHIRADI.
  /**
   * QORALAMA TAYYORLASH rejimi. true bo'lsa: draft yaratiladi, HAMMA maydon to'ldiriladi
   * va HAMMA hujjat biriktiriladi — lekin save-suit HAM, send-to-court HAM QILINMAYDI va
   * qoralama O'CHIRILMAYDI. ADOLAT'da to'liq tayyor qoralama qoladi; yurist uni portalda
   * ochib, ko'zdan kechirib, O'ZI (portalning o'z interfeysi orqali) yuboradi.
   *
   * NEGA ENG XAVFSIZ: yakuniy save-suit'ni PORTALNING O'ZI qiladi (to'g'ri payload bilan),
   * ya'ni bizning teskari-muhandislik qilingan save-suit payload'imiz umuman ishlatilmaydi —
   * nuqsonli da'vo xavfi yo'q. Va qoralama sud kunlik kvotasini/oynasini band qilmaydi,
   * shuning uchun 24/7 tayyorlash mumkin.
   */
  prepareDraftOnly?: boolean;
  /**
   * SUIT-READY (stop-B): save-suit QILINADI — ADOLAT'da HAQIQIY ish yaratiladi va u
   * «Mening murojaatlarim»da (real bo'limda) turadi, xuddi yuborishga tayyorday. LEKIN
   * send-to-court QILINMAYDI — yurist portalda ochib, oxirgi «Sudga yuborish»ni O'ZI bosadi.
   * Bu prepareDraftOnly (stop-A: «Qoralamalar»da wizard holati)dan FARQLI: bu yerda ish
   * ROSMAN yaratilgan. ⛔ MUHIM: bu bayroq TRUE bo'lsa send-to-court hech QACHON ishlamaydi —
   * CABINET_ALLOW_SEND_TO_COURT/confirmedLiveVerified'дан QAT'I NAZAR (allowSend gate'idan
   * OLDIN qaytadi). prepareDraftOnly bilan bir vaqtda berilmaydi (ikkovi ikki xil to'xtash).
   */
  prepareSuitOnly?: boolean;
  pkcs7Signature?: string; // Operator E-IMZO imzosi (ixtiyoriy)
  /** Bojdan ozod qilish asosi (GET /guide/duty-reasons). Yuridik tanlov — builder izohiga qarang. */
  dutyReasonId?: string | null;
  /** save-suit oqimi jonli tekshirilgach TRUE qilinadi — shundan keyin yakuniy yuborish ishlaydi. */
  confirmedLiveVerified?: boolean;
  /** Har bosqichda chaqiriladi — chaqiruvchi buni bazaga yozib UI'da ko'rsatadi.
   *  Bitta ish 60 soniyagacha davom etadi; bosqichsiz UI qotib qolgandek ko'rinadi. */
  onStep?: (step: string) => void;
}

export interface SubmissionResult {
  ok: boolean;
  step: 'COMPLETED' | 'DRAFT_CREATED' | 'DRAFT_READY' | 'SUIT_READY' | 'FAILED';
  draftId?: string;
  caseId?: string;
  caseNumber?: string;
  registryNumber?: string;
  uploadedFiles?: UploadedCabinetFile[];
  /** Xato turi (AUTH/BLOCKED/RATE_LIMIT/BAD_REQUEST/SERVER) — chaqiruvchi shunga qarab qaror qiladi. */
  kind?: CabinetErrorKind;
  /**
   * Xatoning MA'NOSI (texnik turi emas). Hozircha bitta qiymat:
   *   UNPAID_RECEIPT — davlat boji to'lanmagan. Bu «nosozlik» emas, ish shunchaki HALI
   *   yuborishga tayyor emas: qayta urinish hech narsani o'zgartirmaydi, to'lov kerak.
   *   Chaqiruvchi shunga qarab ishni FAILED emas, SKIPPED qiladi va qayta urinmaydi.
   */
  reason?: 'UNPAID_RECEIPT';
  error?: string;
}

export class CabinetSubmitEngine {
  // Sessiya partiyada bir marta tekshiriladi (pastdagi STEP 1 izohiga qarang).
  private sessionChecked = false;
  private client: CabinetApiClient;
  private uploader: CabinetFileUploader;

  constructor(session: CabinetAuthSession) {
    this.client = new CabinetApiClient(session);
    this.uploader = new CabinetFileUploader(this.client);
  }

  /**
   * Bitta ishni to'liq Adolat portaliga kiritadi:
   * 1. Qoralama yaratish
   * 2. Sud / da'vogar / summa kiritish
   * 3. Qarzdor (javobgar) ma'lumotlarini kiritish
   * 4. Barcha ilova hujjatlarni (ariza, oferta, guvohnoma, ishonchnoma) yuklash
   * 5. Agar dryRun bo'lsa: qoralamani o'chirib tozalaydi
   * 6. Agar real submit bo'lsa: send-to-court orqali sudga topshiradi va ish raqamini qaytaradi
   */
  async submitCase(caseData: SourceCaseData, files: CaseFileToUpload[], options: SubmissionOptions = {}): Promise<SubmissionResult> {
    let draftId: string | undefined;
    // save-suit qaytargan HAQIQIY sud ishi id'si. try'dan TASHQARIDA — chunki keyingi
    // qadam (send-to-court) uzilsa ham bu id yo'qolmasligi shart: portal so'rovni
    // allaqachon bajargan bo'lishi mumkin, ya'ni da'vo rasman berilgan.
    let caseId: string | undefined;
    try {
      // STEP 0: HUJJAT TO'LIQLIGI — tarmoqqa chiqishdan OLDIN.
      //
      // 2026-09-07 da case 9327 bilan aynan shu holat yuz berdi: bazada 2 ta hujjat yozuvi
      // bor edi, lekin ikkalasi ham BIR XIL talabnoma kvitansiyasi — imzolangan ariza
      // umuman yo'q. Skript esa uni bemalol qabul qilib, ADOLAT'da faqat pochta
      // kvitansiyasidan iborat da'vo yaratdi. Agar yuborish yoqilgan bo'lganida, real
      // odamga qarshi ARIZASIZ da'vo rasman berilgan bo'lardi.
      //
      // Sayt oqimi (prepare-ready -> selectReadyCaseIds) 5 shartni tekshiradi, lekin
      // to'g'ridan-to'g'ri chaqiruvlar (skript, qayta urinish) uni chetlab o'tadi —
      // shuning uchun tekshiruv dvigatelning O'ZIDA turishi kerak.
      // Ikkita hujjatsiz da'vo yuborilmaydi:
      //   ARIZA  — palatada imzolangan ariza skani (da'voning o'zi);
      //   OFERTA — mikroqarz shartnomasi. Bizning toifamiz 111 «yozma bitimga asoslangan
      //            talab», ya'ni oferta da'voning HUQUQIY ASOSI. Usiz da'vo asossiz.
      //   TALABNOMA + uning KVITANSIYASI — da'vodan oldin qarzdorga talab qo'yilgani va
      //            u yetkazilgani isboti. Ikkisi juft: xatning MAZMUNI va yetkazilganlik
      //            dalili. Bittasi yetishmasa sud «talab qo'yilganmi?» degan savolga
      //            javob topa olmaydi.
      const need: { kind: CaseFileToUpload['kind']; label: string; hint: string }[] = [
        { kind: 'ARIZA', label: 'imzolangan ariza', hint: 'palatadan kelgan imzolangan arizani skanerlab biriktiring' },
        { kind: 'OFERTA', label: 'oferta (mikroqarz shartnomasi)', hint: 'oferta portfel ma\'lumotidan yaratiladi — kredit yozuvlari va chromium borligini tekshiring' },
        // TALABNOMANING O'ZI majburiy EMAS (2026-09-10 foydalanuvchi qarori): sudga xatning
        // mazmuni emas, faqat YETKAZILGANLIK kvitansiyasi (TALABNOMA_CHECK) kerak.
        { kind: 'TALABNOMA_CHECK', label: 'talabnoma kvitansiyasi', hint: 'xat.hippo (UZPOST) yetkazish kvitansiyasini biriktiring' },
      ];
      const missing = need.filter((x) => !files.some((f) => f.kind === x.kind));
      if (missing.length) {
        const bor = files.map((f) => f.kind).join(', ') || 'hech narsa';
        throw new Error(
          `Yetishmayotgan hujjat: ${missing.map((m) => m.label).join(', ')}. ` +
          `Bunday da'voni sudga yuborib bo'lmaydi — sud qaytaradi, lekin da'vo rasman berilgan ` +
          `bo'lib qoladi. Mavjud hujjatlar: ${bor}. Nima qilish kerak: ${missing.map((m) => m.hint).join('; ')}.`,
        );
      }

      // STEP 1: sessiya tekshirish — PARTIYADA FAQAT BIR MARTA.
      //
      // Sessiya butun partiya davomida o'zgarmaydi (bitta token), shuning uchun uni har
      // ishda tekshirish 4 soniyalik behuda so'rov edi: 200 ishlik partiyada ~13 daqiqa.
      // Birinchi ishda tekshiramiz (token tirikligiga ishonch hosil qilish uchun), keyin
      // o'tkazib yuboramiz. Token o'rtada uzilsa — keyingi so'rovlar 401 beradi va navbat
      // baribir to'xtaydi (AUTH), ya'ni himoya yo'qolmaydi.
      if (!this.sessionChecked) {
        options.onStep?.('Sessiya');
        console.log('▶ [1/7] Sessiya tekshirilmoqda...');
        const userRes = await this.client.get<{ username: string }>(CABINET_ENDPOINTS.userGet);
        console.log(`✔ Sessiya faol: ${userRes.data?.username || 'OK'}`);
        this.sessionChecked = true;
      }

      // STEP 1b: DAVLAT BOJI — qoralama yaratishdan OLDIN.
      //
      // NEGA AYNAN SHU YERDA: ilgari bu tekshiruv 5-qadamda, qoralama yaratilib 10 ta
      // hujjat yuklangandan KEYIN turardi. To'lanmagan kvitansiyali ish shu bosqichgacha
      // yetib borar, keyin 400 bilan yiqilar va ADOLAT'da YETIM QORALAMA + 10 ta behuda
      // yuklangan fayl qolib ketardi (2026-09-07: BRIGHT partiyasida 78 ta to'lanmagan
      // ish shunday «ishlanayotgan» edi — har biri ~1 daqiqa va 15 ta so'rov).
      //
      // Kvitansiyaning O'ZI payloadga qo'shilmaydi (portal xom obyektni qabul qilmaydi),
      // ya'ni bu chaqiruv faqat TEKSHIRUV. Shuning uchun uni eng arzon joyga —
      // hech qanday nojo'ya ta'sirdan oldinga — ko'chirdik.
      // To'langan kvitansiya obyekti (find-by-receipt-number natijasi). courtCosts.receipts'ga
      // biriktirish uchun ushlab qolamiz (portal «+» kvitansiya raqami). Formatini bilish uchun
      // suit-only test rejimida log qilinadi.
      let paidReceipt: unknown = null;
      if (caseData.receiptNumber) {
        // Portal to'lov holatini ham tekshiradi: to'lanmagan uchun 400 «invoiceStatus is
        // not valid» qaytadi — bu HAQIQIY sabab, ish to'xtaydi (lekin hech narsa buzilmaydi:
        // hali qoralama ham, yuklangan fayl ham yo'q).
        //
        // 502/503/504 va timeout esa portalning vaqtinchalik nosozligi, kvitansiyaga
        // aloqasi yo'q (2026-09-07: AXMADJONOV ishida nginx 502 keldi va ish behuda
        // «Yuborilmadi» bo'lib qoldi). Bunda qayta urinamiz, keyin ham bo'lmasa —
        // TEKSHIRMASDAN davom etamiz: u save-suit uchun majburiy emas.
        options.onStep?.('Boji tekshiruvi');
        const TRIES = 3;
        for (let attempt = 1; attempt <= TRIES; attempt++) {
          try {
            const rr = await this.client.post<any>(CABINET_ENDPOINTS.findByReceiptNumber, {
              receipt_number: caseData.receiptNumber,
              receiptNumber: caseData.receiptNumber,
            });
            const rec = (rr.data as any)?.receipt ?? rr.data;
            if (rec) {
              paidReceipt = rec;
              console.log(`✔ Kvitansiya tasdiqlandi: ${caseData.receiptNumber} — ${rec.invoiceStatus ?? '?'} ${rec.paidAmount ?? ''}`);
              if (options.prepareSuitOnly) console.log(`   [suit-test] receipt obyekti: ${JSON.stringify(rec).slice(0, 600)}`);
            }
            break;
          } catch (e: any) {
            const kind = e?.kind as string | undefined;
            const transient = kind === 'SERVER' || kind === 'BLOCKED' || kind === 'RATE_LIMIT';
            if (!transient) {
              // 4xx — kvitansiya haqiqatan nosoz (deyarli har doim: to'lanmagan).
              // `UNPAID_RECEIPT` — chaqiruvchi buni «xato» emas, «hozircha yubora
              // olmaymiz» deb ajratishi uchun (navbatda FAILED emas, SKIPPED bo'ladi).
              const err: any = new Error(
                `Davlat boji to'lanmagan: kvitansiya ${caseData.receiptNumber} portalda tasdiqlanmadi ` +
                `(${e.message?.slice(0, 160)}). Buxgalteriyaga to'lovga bering — to'langach ish o'zi ketadi.`,
              );
              err.reason = 'UNPAID_RECEIPT';
              throw err;
            }
            if (attempt === TRIES) {
              console.warn(`⚠ Kvitansiya tekshiruvi ${TRIES} marta portal nosozligi bilan tugadi — tekshirmasdan davom etamiz.`);
              break;
            }
            console.warn(`⚠ Kvitansiya tekshiruvi (${attempt}/${TRIES}) portal nosozligi: ${kind}. Qayta urinamiz...`);
            await new Promise((r) => setTimeout(r, 5_000 * attempt));
          }
        }
      }

      // STEP 2: draft yaratish (bo'sh {})
      options.onStep?.('Qoralama ochilmoqda');
      console.log('▶ [2/7] Qoralama ochilmoqda...');
      const draftRes = await this.client.post<DraftCaseResponse>(CABINET_ENDPOINTS.draftCreate, CabinetPayloadBuilder.buildDraft());
      draftId = draftRes.data?.id;
      if (!draftId) throw new Error('Qoralama ochilmadi (draftId olinmadi).');
      console.log(`✔ Qoralama yaratildi: ID = ${draftId}`);

      // STEP 3: sud/da'vogar + ish turkumi/summa — BITTA PUT (server to'liq details'ni kutadi)
      options.onStep?.('Sud va summa');
      console.log('▶ [3/7] Sud/da\'vogar + ish turkumi/summa saqlanmoqda...');
      const details: DraftDetails = {
        // Ish turi — portal buni 1-qadamda kutadi; bizning eski kod yubormasdi va qoralama
        // form_step=0 da qolib ketardi.
        courtInfo: CabinetPayloadBuilder.buildCourtInfo(),
        createApplication: CabinetPayloadBuilder.buildCreateApplication(caseData),
        materialCreateApplication: null,
        baseInfo: CabinetPayloadBuilder.buildBaseInfo(caseData.debt),
        materialBaseInfo: null,
        defendantInfo: null,
        courtCosts: null, // bizning ish turi bojidan ozod — bo'sh qoldiriladi
      };
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log('✔ Saqlandi.');

      // STEP 4: javobgar (qarzdor) qo'shilmoqda...
      options.onStep?.('Javobgar');
      console.log('▶ [4/7] Javobgar (qarzdor) qo\'shilmoqda...');
      details.defendantInfo = CabinetPayloadBuilder.buildDefendantInfo(caseData.debtor);
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log(`✔ Javobgar qo'shildi: ${caseData.debtor.fullName}`);

      // STEP 5: hujjatlarni yuklash + qoralamaga BIRIKTIRISH
      options.onStep?.(`Hujjatlar (${files.length} ta)`);
      console.log(`▶ [5/7] ${files.length} ta hujjat yuklanmoqda...`);
      const uploadedFiles = files.length ? await this.uploader.uploadPacket(files) : [];
      console.log(`✔ Hujjatlar yuklandi: ${uploadedFiles.length} ta`);

      // Yuklangan fayllarni wizard "Hujjatlar" bo'limiga yozamiz. Avval bu QILINMASDI —
      // fileId'lar faqat qaytarish qiymatida qolib ketardi va da'vo ilovasiz ketardi.
      const fileRefs: UploadedFileRef[] = uploadedFiles.map((u) => ({
        file_id: u.fileId,
        type_id: u.fileType, // CABINET_DOC_TYPES GUID — 2026-09-06 da guide ro'yxati bilan tasdiqlangan
        name: u.fileName,
        size: u.fileSize,
        mime_type: 'application/pdf',
      }));
      const fileUpload = CabinetPayloadBuilder.buildFileUpload(fileRefs);
      // ⚠️ Pochta kvitansiyasini save-suit `receipts`ga biriktirish HOZIRCHA O'CHIRILGAN.
      // find-by-receipt obyektini shundoq yuborsak, ADOLAT serveri «Cannot set properties of
      // undefined (setting 'is_court_billing')» beradi — ya'ni u boshqa (ichma-ich) shaklni
      // kutadi. Kvitansiyasiz save-suit ISHLAYDI (ish «Murojaatlarim»da yaratiladi, boji 0), va
      // to'lov kvitansiyasi portalning O'ZIDA oxirgi qadamda yaratiladi/biriktiriladi (ekrandagi
      // «...oxirgi qadamda avtomatik tarzda yaratiladi» izohi). To'g'ri formatni frontend
      // save-suit payloadidan aniqlab, keyin yoqamiz. paidReceipt faqat TEKSHIRUV uchun ushlanadi.
      void paidReceipt;
      const courtCosts = CabinetPayloadBuilder.buildCourtCosts({ dutyReasonId: options.dutyReasonId ?? null, receipts: [] });
      details.fileUpload = fileUpload;
      details.courtCosts = courtCosts;
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log(`✔ Hujjatlar qoralamaga biriktirildi (${fileRefs.length} ta).`);

      // ── QORALAMA TAYYOR (prepareDraftOnly) ──────────────────────────────────────────────
      //
      // Hamma maydon to'ldirildi va hujjatlar biriktirildi. save-suit QILINMAYDI: ADOLAT'da
      // to'liq tayyor qoralama qoladi, yurist portalda ochib O'ZI yuboradi. Bu — eng xavfsiz
      // yo'l: yakuniy save-suit'ni portalning O'ZI to'g'ri payload bilan qiladi, va qoralama
      // sud kvotasini band qilmaydi (24/7 tayyorlansa bo'ladi).
      if (options.prepareDraftOnly) {
        console.log(`✔ QORALAMA TAYYOR (ID=${draftId}): hamma maydon + ${fileRefs.length} ta hujjat biriktirildi. Sud ishi YARATILMADI — yurist portalda ko'rib qo'lda yuboradi.`);
        return { ok: true, step: 'DRAFT_READY', draftId, uploadedFiles };
      }

      if (options.dryRun) {
        console.log('⚠ DRY-RUN: qoralama tekshirildi, endi o\'chirilmoqda...');
        await this.client.put(CABINET_ENDPOINTS.draftDelete + draftId);
        console.log('✔ Sinov qoralamasi o\'chirildi.');
        return { ok: true, step: 'DRAFT_CREATED', draftId, uploadedFiles };
      }

      // STEP 6: HAQIQIY SUD ISHINI YARATISH (save-suit).
      //
      // Qoralama (pub-user-draft-cases) — bu faqat wizard holati; undan sud ishi avtomatik
      // YARALMAYDI. Portal frontendi shu bosqichda wizard holatini butunlay boshqa shakldagi
      // payloadga aylantirib POST qiladi, va keyingi qadam aynan shu qaytargan `case id` ni
      // oladi (draftId ni EMAS). Bizning eski kodda bu bosqich UMUMAN yo'q edi — shuning
      // uchun hujjatlar ham biriktirilmasdi. Batafsil: REAL-API-FINDINGS.md
      options.onStep?.('Sud ishi yaratilmoqda');
      console.log('▶ [6/7] Sud ishi yaratilmoqda (save-suit)...');
      const suitPayload = CabinetPayloadBuilder.buildSaveSuit({
        data: caseData,
        courtInfo: details.courtInfo!,
        createApplication: details.createApplication!,
        baseInfo: details.baseInfo!,
        fileUpload,
        courtCosts,
      });
      const suitRes = await this.client.post<any>(CABINET_ENDPOINTS.saveSuitCivil, suitPayload);
      const suitData = suitRes.data as Record<string, any> | undefined;
      // DIQQAT: `caseId` ATAYIN try'dan TASHQARIDA e'lon qilingan (pastdagi `let`).
      // Ilgari u shu yerda `const` edi va catch bloki unga kira olmasdi — natijada
      // save-suit muvaffaqiyatli o'tib, keyin send-to-court uzilsa, ADOLAT'da YARATILGAN
      // haqiqiy ish id'si faqat log'da qolardi. Ish esa FAILED bo'lib, keyingi partiyada
      // qayta tanlanardi va AYNI ODAMGA IKKINCHI da'vo ochilardi.
      caseId = suitData?.id || suitData?.case_id || suitData?.caseId || suitData?.case?.id;
      if (!caseId) {
        throw new Error(
          `Sud ishi yaratildi, lekin javobdan id olinmadi. Javob: ${JSON.stringify(suitData)?.slice(0, 400)}. ` +
          `Qoralama ADOLAT'da saqlanib qoldi (ID=${draftId}).`,
        );
      }
      console.log(`✔ Sud ishi yaratildi: ${caseId} (${suitPayload.case_documents.length} ta hujjat biriktirildi)`);

      // ── SUIT-READY (stop-B) ──────────────────────────────────────────────────────────────
      //
      // save-suit tugadi — ish ADOLAT'da ROSMAN yaratildi va «Mening murojaatlarim»da turadi
      // (xuddi yuborishga tayyorday). LEKIN send-to-court QILINMAYDI: shu yerda MAJBURIY
      // to'xtaymiz, allowSend gate'ига UMUMAN yetib bormaymiz. Ya'ni CABINET_ALLOW_SEND_TO_COURT=1
      // bo'lsa ham suit-only ish real sudga KETMAYDI — yurist portalda ochib O'ZI yuboradi.
      // ok:true — ish haqiqatan tayyorlandi (draft-only'дан farqli: bu real ish id'si bor).
      if (options.prepareSuitOnly) {
        console.log(`✔ MUROJAAT TAYYOR (SUIT-READY): ish ${caseId} «Murojaatlarim»da turibdi — SUDGA YUBORILMADI, yurist O'ZI yuboradi.`);
        return { ok: true, step: 'SUIT_READY', draftId, caseId, uploadedFiles };
      }

      // ⛔ BIRINCHI JONLI TEKSHIRUVGACHA TO'SIQ.
      //
      // Yuqoridagi save-suit payloadi portal frontendining minifikatsiyalangan bundle'idan
      // teskari muhandislik yo'li bilan qurildi. Uning UCH qismi hali JONLI tasdiqlanmagan:
      //   1. javobdagi id maydonining aniq nomi (yuqorida bir necha variant sinaladi),
      //   2. `courtCosts.duty_reason_id` — bojdan ozod qilishning qaysi moddasi bizning
      //      da'vomizga tegishli ekani (YURIDIK tanlov, kodda taxmin qilinmagan),
      //   3. javobgarning `entity`/`entity_details` shakli (getParticipant'dan olingan).
      //
      // Bu uchtasining birortasi noto'g'ri bo'lsa natija «xato» emas — REAL odamga qarshi
      // NUQSONLI da'vo rasman berilgan bo'ladi va qaytarib bo'lmaydi. Shuning uchun avtomatik
      // yuborish BIRINCHI muvaffaqiyatli jonli tekshiruvdan keyin ochiladi.
      //
      // Ochish tartibi: shu holatda bitta ishni ishga tushiring — save-suit gacha hammasi
      // bajariladi va ish ADOLAT'da to'liq tayyor holda turadi. O'sha ishni portalda ochib,
      // hujjatlari va tomonlari to'g'ri ekanini KO'ZINGIZ bilan tekshiring, qo'lda yuboring.
      // To'g'ri chiqsa — shu to'siqni olib tashlaymiz va qolgani avtomatik ketaveradi.
      // `ok: false` — ATAYIN. Avval bu yerda `ok: true` turardi va chaqiruvchilar buni
      // muvaffaqiyat deb o'qib «SUDGA TOPSHIRILDI» yozib, bazani COURT_SUBMITTED qilib
      // qo'yishardi (2026-09-07 da case 9327 bilan aynan shunday bo'ldi). Sudga
      // topshirilmagan ish HECH QACHON topshirilgan deb belgilanmasligi kerak.
      // YOQISH KALITI — ATAYIN muhit o'zgaruvchisida, kodda emas:
      //   CABINET_ALLOW_SEND_TO_COURT=1
      // Sabab: bu kalit yoqilgach tizim REAL odamlarga qarshi REAL da'volarni rasman
      // beradi va qaytarib bo'lmaydi. Bunday qarorni kod (yoki uni yozgan kishi) emas,
      // operator ONGLI ravishda, o'z muhitida qabul qilishi kerak. Kod tarafida
      // `confirmedLiveVerified` bilan ham berish mumkin (chaqiruvchi aniq uzatsa).
      //
      // YOQISHDAN OLDIN kamida bitta ish shu holatda oxirigacha o'tsin va ADOLAT'da
      // ko'zdan kechirilsin: hujjatlari (ariza + oferta + chek + firma hujjatlari),
      // tomonlari (da'vogar AYNAN shu firma, javobgar to'g'ri shaxs) va summasi.
      // 2026-09-07 holati: har sinov yangi nuqson ochdi (summa formati → bo'sh summa →
      // sud sozlamasi → kvitansiya 500 → boshqa firmaning ishonchnomasi), ya'ni birorta
      // ish hali toza o'tmagan.
      const allowSend = options.confirmedLiveVerified === true
        || process.env.CABINET_ALLOW_SEND_TO_COURT === '1';
      if (!allowSend) {
        return {
          ok: false,
          step: 'DRAFT_CREATED',
          draftId,
          caseId,
          uploadedFiles,
          error: `Sud ishi ADOLAT'da to'liq tayyorlandi (id=${caseId}, ${suitPayload.case_documents.length} ta hujjat), ` +
            `lekin YAKUNIY YUBORISH o'chirilgan. Portalda ochib tekshiring va qo'lda yuboring. ` +
            `Avtomatik yuborishni yoqish uchun: CABINET_ALLOW_SEND_TO_COURT=1 (.env.production).`,
        };
      }

      // STEP 7: Sudga topshirish — save-suit qaytargan CASE id bilan (draftId bilan EMAS).
      options.onStep?.('Sudga topshirilmoqda');
      console.log('▶ [7/7] Sudga topshirilmoqda (send-to-court)...');
      const submitRes = await this.client.put<any>(
        `${CABINET_ENDPOINTS.sendToCourt}${caseId}`,
        options.pkcs7Signature ? { signature: options.pkcs7Signature } : {},
      );

      // Sud ish RAQAMI yuborish paytida berilmaydi — uni sud kantselyariyasi ro'yxatga
      // olgach beradi (masalan «2-1004-2612/44765»). Shu paytgacha ish portalda REGISTER
      // holatida turadi. Avval bu yerda 'YUBORILDI' degan zaxira matn qo'yilardi va u
      // bazaga HAQIQIY ish raqami sifatida yozilib ketardi — endi null qoladi.
      const caseNumber = (submitRes.data as any)?.case_number || (submitRes.data as any)?.caseNumber || null;
      const registryNumber = (submitRes.data as any)?.registry_number || (submitRes.data as any)?.registryNumber;
      console.log(`🎉 SUDGA YUBORILDI! Ish raqami: ${caseNumber}${registryNumber ? ` (Reestr: ${registryNumber})` : ''}`);

      return {
        ok: true,
        step: 'COMPLETED',
        draftId,
        caseId,
        caseNumber,
        registryNumber,
        uploadedFiles,
      };
    } catch (error: any) {
      const cause = error?.cause;
      const causeStr = cause?.message || cause?.code || (typeof cause === 'object' ? JSON.stringify(cause) : String(cause || ''));
      console.error('❌ Xatolik:', error.message, causeStr ? `(Sabab: ${causeStr})` : '');
      return {
        ok: false,
        step: 'FAILED',
        draftId,
        // caseId BOR bo'lsa — ADOLAT'da ish ALLAQACHON yaratilgan. Chaqiruvchi buni
        // saqlashi SHART, aks holda ish qayta yuboriladi va ikkinchi da'vo ochiladi.
        caseId,
        // Xato TURI ham yuqoriga chiqadi: ilgari u shu catch ichida yo'qolardi va
        // chaqiruvchidagi AUTH-to'xtatish hamda blok-himoyasi hech qachon ishlamasdi.
        kind: error instanceof CabinetRequestError ? error.kind : undefined,
        reason: error?.reason === 'UNPAID_RECEIPT' ? 'UNPAID_RECEIPT' : undefined,
        error: `${error.message} ${causeStr ? '(' + causeStr + ')' : ''}`.trim(),
      };
    }
  }
}
