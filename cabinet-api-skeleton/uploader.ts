// cabinet-api-skeleton/uploader.ts
// Sud paketidagi barcha fayllarni tegishli slot GUID'lari bilan portalga yuklash moduli.

import type { CabinetApiClient } from './client';
import { CABINET_DOC_TYPES } from './constants';
import type { UploadedCabinetFile } from './types';

export interface CaseFileToUpload {
  kind: 'ARIZA' | 'TALABNOMA' | 'TALABNOMA_CHECK' | 'ISHONCHNOMA' | 'GUVOHNOMA' | 'OFERTA' | 'SHARTNOMA' | 'BOJI_RECEIPT';
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
  async uploadSingle(file: CaseFileToUpload): Promise<UploadedCabinetFile> {
    const fileTypeGuid = this.resolveFileTypeGuid(file.kind);
    const result = await this.client.uploadFile(file.buffer, file.fileName, fileTypeGuid);
    return {
      fileId: result.id,
      fileName: file.fileName,
      fileType: fileTypeGuid,
      fileSize: file.buffer.length,
    };
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
