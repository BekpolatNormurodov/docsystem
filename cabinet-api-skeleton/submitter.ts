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
  dryRun?: boolean; // true bo'lsa: draft yaratib to'ldiradi, TEKSHIRADI, keyin O'CHIRADI.
  pkcs7Signature?: string; // Operator E-IMZO imzosi (ixtiyoriy)
}

export interface SubmissionResult {
  ok: boolean;
  step: 'COMPLETED' | 'DRAFT_CREATED' | 'FAILED';
  draftId?: string;
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

      // STEP 5: hujjatlarni yuklash
      console.log(`▶ [5/6] ${files.length} ta hujjat yuklanmoqda...`);
      const uploadedFiles = files.length ? await this.uploader.uploadPacket(files) : [];
      console.log(`✔ Hujjatlar yuklandi: ${uploadedFiles.length} ta`);

      if (options.dryRun) {
        console.log('⚠ DRY-RUN: qoralama tekshirildi, endi o\'chirilmoqda...');
        await this.client.put(CABINET_ENDPOINTS.draftDelete + draftId);
        console.log('✔ Sinov qoralamasi o\'chirildi.');
        return { ok: true, step: 'DRAFT_CREATED', draftId, uploadedFiles };
      }

      // ⛔ HUJJAT BIRIKTIRISH HALI ULANMAGAN — YUBORISHDAN OLDINGI TO'SIQ.
      //
      // Yuqoridagi uploadPacket() fayllarni portal fayl-omboriga yuklaydi va fileId'larni
      // qaytaradi, LEKIN bu ID'lar hech qayerga yozilmaydi: DraftDetails (types.ts) da hujjat
      // bo'limi YO'Q va ular PUT bilan qoralamaga qaytarilmaydi. Ya'ni da'vo sudga ILOVASIZ
      // ketadi — imzolangan ariza ham, talabnoma kvitansiyasi ham, oferta ham biriktirilmagan
      // holda. Bunday da'voni sud qaytaradi, lekin da'vo RASMAN BERILGAN bo'ladi (qaytarib
      // bo'lmaydi) va davlat boji/pochta xarajati ham sarflanadi.
      //
      // Ochish uchun (bir martalik aniqlash ishi):
      //   1. ADOLAT UI'sida qo'lda BITTA qoralama yarating va unga hujjat biriktiring.
      //   2. GET /api/cabinet/pub-user-draft-cases/list dan o'sha qoralamani o'qing va
      //      fileId'lar QAYSI maydonda turishini aniqlang (details ichida yangi bo'limmi,
      //      yoki alohida endpoint orqalimi).
      //   3. types.ts DraftDetails'ga o'sha bo'limni qo'shing, builder'da to'ldiring va
      //      shu yerda uploadedFiles'ni details'ga yozib, yana bir marta PUT qiling.
      //   4. Shundan keyin bu to'siqni olib tashlang.
      if (files.length > 0 && uploadedFiles.length > 0) {
        throw new Error(
          `Hujjatlar (${uploadedFiles.length} ta) portalga yuklandi, lekin qoralamaga BIRIKTIRILMADI — ` +
          `bu holda da'vo sudga ilovasiz ketardi va sud uni qaytarardi. Yuborish to'xtatildi. ` +
          `Qoralama ADOLAT'da saqlanib qoldi (ID=${draftId}) — hujjatlarni qo'lda biriktirib, ` +
          `o'sha yerdan yuborishingiz mumkin. Sabab va yechim: cabinet-api-skeleton/submitter.ts izohiga qarang.`,
        );
      }

      // STEP 6: Sudga topshirish (send-to-court) — HAQIQIY SUDGA TOPSHIRISH
      console.log('▶ [6/6] Sudga topshirilmoqda (send-to-court)...');
      const submitRes = await this.client.put<any>(
        `${CABINET_ENDPOINTS.sendToCourt}${draftId}`,
        options.pkcs7Signature ? { signature: options.pkcs7Signature } : {},
      );

      const caseNumber = (submitRes.data as any)?.case_number || (submitRes.data as any)?.caseNumber || 'YUBORILDI';
      const registryNumber = (submitRes.data as any)?.registry_number || (submitRes.data as any)?.registryNumber;
      console.log(`🎉 SUDGA YUBORILDI! Ish raqami: ${caseNumber}${registryNumber ? ` (Reestr: ${registryNumber})` : ''}`);

      return {
        ok: true,
        step: 'COMPLETED',
        draftId,
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
