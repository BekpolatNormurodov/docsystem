// cabinet-api-skeleton/submitter.ts
// cabinet.sud.uz (Adolat) tizimiga arizalarni API orqali kiritib yuborishning to'liq 8 bosqichli dvigateli.

import { CabinetApiClient } from './client';
import { CabinetFileUploader, type CaseFileToUpload } from './uploader';
import { CabinetPayloadBuilder, type SourceCaseData } from './builder';
import { CABINET_ENDPOINTS, CABINET_COURT_IDS } from './constants';
import type {
  CabinetAuthSession,
  DraftCaseResponse,
  SaveSuitResponse,
  SendToCourtResponse,
  UploadedCabinetFile,
} from './types';

export interface SubmissionOptions {
  dryRun?: boolean; // Agar true bo'lsa, qoralama yaratib tekshiradi va o'chirib tashlaydi (send-to-court chaqirmaydi)
  courtGuid?: string;
  pkcs7Signature?: string; // Operator E-IMZO imzosi
}

export interface SubmissionResult {
  ok: boolean;
  step: 'COMPLETED' | 'DRAFT_CREATED' | 'FAILED';
  draftId?: string;
  claimId?: string;
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
   * Bitta ishni boshidan oxirigacha API orqali cabinet.sud.uz ga kiritish
   */
  async submitCase(caseData: SourceCaseData, files: CaseFileToUpload[], options: SubmissionOptions = {}): Promise<SubmissionResult> {
    const courtGuid = options.courtGuid || caseData.courtId || CABINET_COURT_IDS.UCHTEPA_CIVIL;
    let draftId: string | undefined;

    try {
      // ══════════════════════════════════════════════════════════════════════
      // STEP 1: Foydalanuvchi va Sessiya ma'lumotlarini tekshirish
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 1/8] Sessiya tekshirilmoqda...');
      const userRes = await this.client.get<{ id: string; username: string }>(CABINET_ENDPOINTS.userGet);
      console.log(`✔ Sessiya faol: ${userRes.data?.username || 'OK'}`);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 2: Qoralama (Draft) yaratish
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 2/8] Qoralama (Draft) ochilmoqda...');
      const draftPayload = CabinetPayloadBuilder.buildDraft(courtGuid);
      const draftRes = await this.client.post<DraftCaseResponse>(CABINET_ENDPOINTS.draftCreate, draftPayload);

      draftId = (draftRes.data as any)?.id || (draftRes.data as any)?.case_id;
      if (!draftId) {
        throw new Error('Qoralama ochilmadi (draftId olinmadi).');
      }
      console.log(`✔ Qoralama yaratildi: ID = ${draftId}`);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 3: Da'vogar (Firma / MMT) ma'lumotlarini kiritish
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 3/8] Da\'vogar (Firma) biriktirilmoqda...');
      const claimantPayload = CabinetPayloadBuilder.buildClaimant(draftId, caseData.firm);
      await this.client.post(CABINET_ENDPOINTS.participantAdd, claimantPayload);
      console.log(`✔ Da'vogar qo'shildi: ${caseData.firm.name}`);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 4: Javobgar (Qarzdor shaxs) ma'lumotlarini kiritish
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 4/8] Javobgar (Qarzdor) biriktirilmoqda...');
      const defendantPayload = CabinetPayloadBuilder.buildDefendant(draftId, caseData.debtor);
      await this.client.post(CABINET_ENDPOINTS.participantAdd, defendantPayload);
      console.log(`✔ Javobgar qo'shildi: ${caseData.debtor.fullName} (PINFL: ${caseData.debtor.pinfl})`);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 5: Davlat boji va Pochta kvitansiyasini tekshirish/bog'lash
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 5/8] Davlat boji va kvitansiya tekshirilmoqda...');
      if (caseData.receiptNumber) {
        const receiptRes = await this.client.post<any>(CABINET_ENDPOINTS.findByReceiptNumber, {
          receipt_number: caseData.receiptNumber,
        });
        console.log(`✔ Kvitansiya topildi: ${caseData.receiptNumber}`);
      } else {
        console.log('ℹ Kvitansiya raqami berilmagan (Palata imtiyozi yoki keyinroq to\'lanadi).');
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 6: Hujjatlarni rasmiy slot GUID'lari bilan yuklash
      // ══════════════════════════════════════════════════════════════════════
      console.log(`▶ [Step 6/8] ${files.length} ta ilova hujjat portalga yuklanmoqda...`);
      const uploadedFiles = await this.uploader.uploadPacket(files);
      const uploadedFileIds = uploadedFiles.map((f) => f.fileId);
      console.log(`✔ Hujjatlar muvaffaqiyatli yuklandi: [${uploadedFileIds.join(', ')}]`);

      // ══════════════════════════════════════════════════════════════════════
      // STEP 7: Da'voni yakuniy saqlash (save-suit)
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 7/8] Da\'vo arizasi saqlanmoqda (save-suit)...');
      const saveSuitPayload = CabinetPayloadBuilder.buildSaveSuit(draftId, courtGuid, caseData, uploadedFileIds);
      const suitRes = await this.client.post<SaveSuitResponse>(CABINET_ENDPOINTS.saveSuit, saveSuitPayload);

      const claimId = (suitRes.data as any)?.claim_id || (suitRes.data as any)?.id || draftId;
      console.log(`✔ Da'vo shakllantirildi: Claim ID = ${claimId}`);

      // DRY-RUN REJIMI TEKSHIRUVI:
      if (options.dryRun) {
        console.log('⚠ DRY-RUN REJIMI: Sudga jo\'natilmaydi! Qoralama tozalanyapti...');
        await this.client.delete(`${CABINET_ENDPOINTS.draftDelete}${draftId}`);
        console.log('✔ Sinov qoralamasi o\'chirildi.');
        return {
          ok: true,
          step: 'DRAFT_CREATED',
          draftId,
          claimId,
          uploadedFiles,
        };
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 8: E-IMZO bilan sudga kiritib yuborish (send-to-court)
      // ══════════════════════════════════════════════════════════════════════
      console.log('▶ [Step 8/8] Sudga kiritib yuborilmoqda (send-to-court)...');
      const submitRes = await this.client.put<SendToCourtResponse>(
        `${CABINET_ENDPOINTS.sendToCourt}${claimId}`,
        options.pkcs7Signature ? { signature: options.pkcs7Signature } : {},
      );

      const caseNumber = (submitRes.data as any)?.case_number || 'YUBORILDI';
      const registryNumber = (submitRes.data as any)?.registry_number;
      console.log(`🎉 SUDGA MUVAFFAQIYATLI TOPSHIRILDI! Ish raqami: ${caseNumber}`);

      return {
        ok: true,
        step: 'COMPLETED',
        draftId,
        claimId,
        caseNumber,
        registryNumber,
        uploadedFiles,
      };
    } catch (error: any) {
      const cause = error?.cause;
      const causeStr = cause?.message || cause?.code || (typeof cause === 'object' ? JSON.stringify(cause) : String(cause || ''));
      console.error('❌ Sudga kiritishda xatolik:', error.message, causeStr ? `(Sabab: ${causeStr})` : '');
      if (cause?.stack) {
        console.error('   Cause stack:', cause.stack);
      }
      return {
        ok: false,
        step: 'FAILED',
        draftId,
        error: `${error.message} ${causeStr ? '(' + causeStr + ')' : ''}`.trim(),
      };
    }
  }
}
