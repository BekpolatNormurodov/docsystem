// cabinet-api-skeleton/uploader.ts
// Sud paketidagi barcha fayllarni tegishli slot GUID'lari bilan portalga yuklash moduli.

import { createHash } from 'node:crypto';
import type { CabinetApiClient } from './client';
import { CABINET_DOC_TYPES } from './constants';
import type { UploadedCabinetFile } from './types';

// FIRMA HUJJATLARI — bir firmaning HAMMA ishida BAYT-BAYTIGA bir xil (guvohnoma,
// ishonchnoma, shartnoma). Ularni har ish uchun qayta yuklash — sof isrof: har biri
// UPLOAD_GAP_MS (4s) va bitta so'rov. Bir partiyada 200 ish × 3 hujjat = 600 ta behuda
// yuklash ≈ 40 daqiqa. Portalning fayl ombori draftga emas, AKKAUNTGA bog'liq
// (`/case/file/upload` da draftId yo'q), shuning uchun bir marta yuklangan fayl id'sini
// bir necha da'voga biriktirish mumkin — Angular frontendi ham shunday ishlaydi.
const CACHEABLE_KINDS = new Set(['GUVOHNOMA', 'ISHONCHNOMA', 'SHARTNOMA']);

export interface CaseFileToUpload {
  // `BOSHQA` — turi aniqlanmagan hujjat. ATAYIN alohida: ilgari notanish tur «OFERTA»
  // bo'lib qolardi va majburiy «yozma asos bormi?» tekshiruvini aldab o'tardi.
  kind: 'ARIZA' | 'TALABNOMA' | 'TALABNOMA_CHECK' | 'ISHONCHNOMA' | 'GUVOHNOMA' | 'OFERTA' | 'SHARTNOMA' | 'BOJI_RECEIPT' | 'BOSHQA';
  fileName: string;
  buffer: Buffer;
}

export class CabinetFileUploader {
  private client: CabinetApiClient;
  // Partiya davomida (bitta engine) firma hujjatlari id'lari — qayta yuklamaslik uchun.
  private firmDocCache = new Map<string, UploadedCabinetFile>();

  constructor(client: CabinetApiClient) {
    this.client = client;
  }

  /**
   * Fayl turiga qarab portalning rasmiy file_type GUID'ini aniqlash
   */
  resolveFileTypeGuid(kind: CaseFileToUpload['kind']): string {
    switch (kind) {
      case 'ARIZA':
        return CABINET_DOC_TYPES.ARIZA;
      case 'TALABNOMA':
        return CABINET_DOC_TYPES.TALABNOMA;
      case 'TALABNOMA_CHECK':
        return CABINET_DOC_TYPES.TALABNOMA_CHECK;
      case 'ISHONCHNOMA':
        return CABINET_DOC_TYPES.ISHONCHNOMA;
      case 'GUVOHNOMA':
        return CABINET_DOC_TYPES.GUVOHNOMA;
      case 'BOJI_RECEIPT':
        return CABINET_DOC_TYPES.POCHTA_XARAJATI_KVITANSIYA;
      case 'OFERTA':
      case 'SHARTNOMA':
      default:
        return CABINET_DOC_TYPES.BOSHQA_HUJJATLAR;
    }
  }

  /**
   * Bitta faylni yuklash
   */
  /**
   * Bitta faylni yuklash, o'tkinchi xatoda QAYTA URINISH bilan.
   *
   * NEGA shu yerda, ish darajasida emas: 2026-09-07 da jonli partiyada portal fayl
   * yuklashda 502 Bad Gateway berdi va butun ish FAILED bo'ldi. Ishni boshidan qaytarish
   * mumkin emas — qoralama allaqachon yaratilgan, qaytarsak ADOLAT'da IKKINCHI (yetim)
   * qoralama paydo bo'ladi. Shuning uchun qayta urinish aynan shu faylga qo'llanadi:
   * hech narsa takrorlanmaydi, ish esa o'tkinchi uzilish tufayli yo'qolmaydi.
   *
   * Faqat SERVER/tarmoq xatolari qaytariladi (502/503/504, ulanish uzilishi). 4xx —
   * payload yoki huquq muammosi, uni qayta urinish tuzatmaydi.
   */
  async uploadSingle(file: CaseFileToUpload, attempts = 3): Promise<UploadedCabinetFile> {
    const fileTypeGuid = this.resolveFileTypeGuid(file.kind);
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        const result = await this.client.uploadFile(file.buffer, file.fileName, fileTypeGuid);
        return {
          fileId: result.id,
          fileName: file.fileName,
          fileType: fileTypeGuid,
          fileSize: file.buffer.length,
        };
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        const transient = /\[50[234]\]|Bad Gateway|ECONNRESET|ETIMEDOUT|socket hang up|javob bermadi/i.test(msg);
        if (!transient || i === attempts) throw e;
        const waitMs = 5000 * i; // 5s, 10s — portalni bosmaslik uchun o'sib boradi
        console.warn(`[upload] ${file.fileName}: ${msg.slice(0, 80)} — ${waitMs / 1000}s dan keyin qayta (${i}/${attempts - 1})`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr;
  }

  /**
   * Barcha zarur hujjatlarni ketma-ketlikda xavfsiz yuklash
   */
  async uploadPacket(files: CaseFileToUpload[]): Promise<UploadedCabinetFile[]> {
    const uploaded: UploadedCabinetFile[] = [];

    for (const file of files) {
      // FIRMA HUJJATINI QAYTA YUKLAMAYMIZ — birinchi ishda yuklangan id qayta ishlatiladi
      // (yuqoridagi `CACHEABLE_KINDS` izohiga qarang). Kalit: tur + fayl mazmuni (sha256),
      // ya'ni firma hujjatini almashtirsangiz yangi id o'z-o'zidan yuklanadi.
      if (CACHEABLE_KINDS.has(file.kind)) {
        const key = `${file.kind}:${createHash('sha256').update(file.buffer).digest('hex')}`;
        const hit = this.firmDocCache.get(key);
        if (hit) {
          // Yangi ishga MOS nom bilan biriktiramiz (id o'sha, nomi shu ishникi bo'lsin).
          uploaded.push({ ...hit, fileName: file.fileName });
          continue;
        }
        const up = await this.uploadSingle(file);
        this.firmDocCache.set(key, up);
        uploaded.push(up);
        continue;
      }
      const up = await this.uploadSingle(file);
      uploaded.push(up);
    }

    return uploaded;
  }
}
