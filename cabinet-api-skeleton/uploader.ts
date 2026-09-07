// cabinet-api-skeleton/uploader.ts
// Sud paketidagi barcha fayllarni tegishli slot GUID'lari bilan portalga yuklash moduli.

import type { CabinetApiClient } from './client';
import { CABINET_DOC_TYPES } from './constants';
import type { UploadedCabinetFile } from './types';

export interface CaseFileToUpload {
  // `BOSHQA` — turi aniqlanmagan hujjat. ATAYIN alohida: ilgari notanish tur «OFERTA»
  // bo'lib qolardi va majburiy «yozma asos bormi?» tekshiruvini aldab o'tardi.
  kind: 'ARIZA' | 'TALABNOMA' | 'TALABNOMA_CHECK' | 'ISHONCHNOMA' | 'GUVOHNOMA' | 'OFERTA' | 'SHARTNOMA' | 'BOJI_RECEIPT' | 'BOSHQA';
  fileName: string;
  buffer: Buffer;
}

export class CabinetFileUploader {
  private client: CabinetApiClient;

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
      const up = await this.uploadSingle(file);
      uploaded.push(up);
    }

    return uploaded;
  }
}
