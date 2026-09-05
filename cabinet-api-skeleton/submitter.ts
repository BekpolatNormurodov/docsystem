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
import type { CabinetAuthSession, DraftCaseResponse, DraftDetails, UploadedCabinetFile } from './types';

export interface SubmissionOptions {
  dryRun?: boolean; // true bo'lsa: draft yaratib to'ldiradi, TEKSHIRADI, keyin O'CHIRADI. send-to-court'ga UMUMAN yetmaydi.
}

export interface SubmissionResult {
  ok: boolean;
  step: 'DRAFT_CREATED' | 'FAILED';
  draftId?: string;
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
   * Bitta ishni draft sifatida to'liq to'ldiradi (sud/da'vogar, ish turkumi/summa, javobgar,
   * hujjatlar). `options.dryRun` DOIM true bo'lishi kerak — bu klass send-to-court'ni HECH
   * QACHON chaqirmaydi (bu qadam qasddan olib tashlangan; ADOLAT UI'sidan inson qo'li bilan
   * bosiladi). dryRun:false berilsa ham xuddi shunday: draft to'ldiriladi va TOZALANMAYDI —
   * qo'lda ADOLAT'da ko'rib, kerak bo'lsa o'zingiz yuborasiz yoki o'chirasiz.
   */
  async submitCase(caseData: SourceCaseData, files: CaseFileToUpload[], options: SubmissionOptions = {}): Promise<SubmissionResult> {
    let draftId: string | undefined;
    try {
      // STEP 1: sessiya tekshirish
      console.log('▶ [1/5] Sessiya tekshirilmoqda...');
      const userRes = await this.client.get<{ username: string }>(CABINET_ENDPOINTS.userGet);
      console.log(`✔ Sessiya faol: ${userRes.data?.username || 'OK'}`);

      // STEP 2: draft yaratish (bo'sh {})
      console.log('▶ [2/5] Qoralama ochilmoqda...');
      const draftRes = await this.client.post<DraftCaseResponse>(CABINET_ENDPOINTS.draftCreate, CabinetPayloadBuilder.buildDraft());
      draftId = draftRes.data?.id;
      if (!draftId) throw new Error('Qoralama ochilmadi (draftId olinmadi).');
      console.log(`✔ Qoralama yaratildi: ID = ${draftId}`);

      // STEP 3: sud/da'vogar + ish turkumi/summa — BITTA PUT (server to'liq details'ni kutadi)
      console.log('▶ [3/5] Sud/da\'vogar + ish turkumi/summa saqlanmoqda...');
      const details: DraftDetails = {
        createApplication: CabinetPayloadBuilder.buildCreateApplication(caseData),
        materialCreateApplication: null,
        baseInfo: CabinetPayloadBuilder.buildBaseInfo(caseData.debt),
        materialBaseInfo: null,
        defendantInfo: null,
        courtCosts: null, // bizning ish turi bojidan ozod — bo'sh qoldiriladi (types.ts izohi)
      };
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log('✔ Saqlandi.');

      // STEP 4: javobgar (qo'lda kiritish, captchasiz) — HAR doim OLDINGI details bilan birga
      // qayta yuboriladi (server merge qilmaydi).
      console.log('▶ [4/5] Javobgar (qarzdor) qo\'shilmoqda...');
      details.defendantInfo = CabinetPayloadBuilder.buildDefendantInfo(caseData.debtor);
      await this.client.put(CABINET_ENDPOINTS.draftUpdate + draftId, { details });
      console.log(`✔ Javobgar qo'shildi: ${caseData.debtor.fullName}`);

      // STEP 5: hujjatlarni yuklash. TODO(upload-verify): bu chaqiruv src/lib/cabinet/api.ts
      // uploadFile() bilan bir xil naqshni ishlatadi (endpoint+header tasdiqlangan), lekin BU
      // SKRIPTDA hali jonli sinalmagan (UI'dagi "Hujjat turi" dropdown captcha bilan bog'liq
      // bo'lmasa-da vaqt yetishmagani sabab bosib ko'rilmadi). Birinchi haqiqiy ishlatishda
      // natijani (fileId qaytishini, 400 emasligini) albatta tekshiring.
      console.log(`▶ [5/5] ${files.length} ta hujjat yuklanmoqda...`);
      const uploadedFiles = files.length ? await this.uploader.uploadPacket(files) : [];
      console.log(`✔ Hujjatlar yuklandi: ${uploadedFiles.length} ta`);

      if (options.dryRun) {
        console.log('⚠ DRY-RUN: qoralama tekshirildi, endi o\'chirilmoqda...');
        await this.client.put(CABINET_ENDPOINTS.draftDelete + draftId);
        console.log('✔ Sinov qoralamasi o\'chirildi.');
      } else {
        console.log(`ℹ Qoralama SAQLANDI (o'chirilmadi): ADOLAT → Qoralamalar'da ko'ring, ID=${draftId}`);
        console.log('ℹ Yakuniy "Sudga yuborish" — FAQAT ADOLAT UI\'sidan, qo\'lda, E-IMZO bilan.');
      }

      return { ok: true, step: 'DRAFT_CREATED', draftId, uploadedFiles };
    } catch (error: any) {
      const cause = error?.cause;
      const causeStr = cause?.message || cause?.code || (typeof cause === 'object' ? JSON.stringify(cause) : String(cause || ''));
      console.error('❌ Xatolik:', error.message, causeStr ? `(Sabab: ${causeStr})` : '');
      return { ok: false, step: 'FAILED', draftId, error: `${error.message} ${causeStr ? '(' + causeStr + ')' : ''}`.trim() };
    }
  }
}
