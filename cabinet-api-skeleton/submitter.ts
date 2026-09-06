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

import { CabinetApiClient } from './client';
import { CabinetFileUploader, type CaseFileToUpload } from './uploader';
import { CabinetPayloadBuilder, type SourceCaseData } from './builder';
import { CABINET_ENDPOINTS } from './constants';
import type { CabinetAuthSession, DraftCaseResponse, DraftDetails, UploadedCabinetFile, UploadedFileRef } from './types';

export interface SubmissionOptions {
  dryRun?: boolean; // true bo'lsa: draft yaratib to'ldiradi, TEKSHIRADI, keyin O'CHIRADI.
  pkcs7Signature?: string; // Operator E-IMZO imzosi (ixtiyoriy)
  /** Bojdan ozod qilish asosi (GET /guide/duty-reasons). Yuridik tanlov — builder izohiga qarang. */
  dutyReasonId?: string | null;
  /** save-suit oqimi jonli tekshirilgach TRUE qilinadi — shundan keyin yakuniy yuborish ishlaydi. */
  confirmedLiveVerified?: boolean;
}

export interface SubmissionResult {
  ok: boolean;
  step: 'COMPLETED' | 'DRAFT_CREATED' | 'FAILED';
  draftId?: string;
  caseId?: string;
  caseNumber?: string;
  registryNumber?: string;
  uploadedFiles?: UploadedCabinetFile[];
  error?: string;
}

export class CabinetSubmitEngine {
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
    try {
      // STEP 1: sessiya tekshirish
      console.log('▶ [1/6] Sessiya tekshirilmoqda...');
      const userRes = await this.client.get<{ username: string }>(CABINET_ENDPOINTS.userGet);
      console.log(`✔ Sessiya faol: ${userRes.data?.username || 'OK'}`);

      // STEP 2: draft yaratish (bo'sh {})
      console.log('▶ [2/6] Qoralama ochilmoqda...');
      const draftRes = await this.client.post<DraftCaseResponse>(CABINET_ENDPOINTS.draftCreate, CabinetPayloadBuilder.buildDraft());
      draftId = draftRes.data?.id;
      if (!draftId) throw new Error('Qoralama ochilmadi (draftId olinmadi).');
      console.log(`✔ Qoralama yaratildi: ID = ${draftId}`);

      // STEP 3: sud/da'vogar + ish turkumi/summa — BITTA PUT (server to'liq details'ni kutadi)
      console.log('▶ [3/6] Sud/da\'vogar + ish turkumi/summa saqlanmoqda...');
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
      console.log('▶ [4/6] Javobgar (qarzdor) qo\'shilmoqda...');
      details.defendantInfo = CabinetPayloadBuilder.buildDefendantInfo(caseData.debtor);
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log(`✔ Javobgar qo'shildi: ${caseData.debtor.fullName}`);

      // STEP 5: hujjatlarni yuklash + qoralamaga BIRIKTIRISH
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
      const courtCosts = CabinetPayloadBuilder.buildCourtCosts({ dutyReasonId: options.dutyReasonId ?? null });
      details.fileUpload = fileUpload;
      details.courtCosts = courtCosts;
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log(`✔ Hujjatlar qoralamaga biriktirildi (${fileRefs.length} ta).`);

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
      const caseId: string | undefined =
        suitData?.id || suitData?.case_id || suitData?.caseId || suitData?.case?.id;
      if (!caseId) {
        throw new Error(
          `Sud ishi yaratildi, lekin javobdan id olinmadi. Javob: ${JSON.stringify(suitData)?.slice(0, 400)}. ` +
          `Qoralama ADOLAT'da saqlanib qoldi (ID=${draftId}).`,
        );
      }
      console.log(`✔ Sud ishi yaratildi: ${caseId} (${suitPayload.case_documents.length} ta hujjat biriktirildi)`);

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
      if (!options.confirmedLiveVerified) {
        return {
          ok: true,
          step: 'DRAFT_CREATED',
          draftId,
          caseId,
          uploadedFiles,
          error: `Sud ishi ADOLAT'da to'liq tayyorlandi (id=${caseId}, ${suitPayload.case_documents.length} ta hujjat). ` +
            `Yakuniy yuborish hali avtomatik emas — payloadning 3 qismi jonli tasdiqlanmagan. ` +
            `Portalda ochib tekshiring va qo'lda yuboring; to'g'ri chiqsa avtomatik rejim ochiladi.`,
        };
      }

      // STEP 7: Sudga topshirish — save-suit qaytargan CASE id bilan (draftId bilan EMAS).
      console.log('▶ [7/7] Sudga topshirilmoqda (send-to-court)...');
      const submitRes = await this.client.put<any>(
        `${CABINET_ENDPOINTS.sendToCourt}${caseId}`,
        options.pkcs7Signature ? { signature: options.pkcs7Signature } : {},
      );

      const caseNumber = (submitRes.data as any)?.case_number || (submitRes.data as any)?.caseNumber || 'YUBORILDI';
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
      return { ok: false, step: 'FAILED', draftId, error: `${error.message} ${causeStr ? '(' + causeStr + ')' : ''}`.trim() };
    }
  }
}
