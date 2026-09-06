// cabinet-api-skeleton/client.ts
// cabinet.sud.uz (cabinetapi.sud.uz) uchun xavfsiz va ishonchli REST mijozi.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { CABINET_BASE_URL } from './constants';
import { paceRequest } from '../src/lib/cabinet/pacer';
import type { CabinetAuthSession } from './types';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
}

/**
 * Xato TURI — navbat uchun hal qiluvchi. Avval hamma nosozlik oddiy Error matniga aylanardi
 * va chaqiruvchi "sessiya o'ldi"ni "tarmoq bloklandi"dan ajrata olmasdi; natijada navbat
 * 100 ta case bo'ylab bir xil xato bilan aylanaverardi. Endi har biri boshqacha ishlanadi:
 *   AUTH       — sessiya tugagan: navbat TO'XTAYDI, operator qayta imzolashi kerak
 *   BLOCKED    — tarmoq/TLS javob bermayapti (2026-09-06 holati): backoff + to'xtash
 *   RATE_LIMIT — portal tezlikni cheklади: backoff
 *   BAD_REQUEST— shu case'ning ma'lumoti nosoz: FAQAT shu case FAILED, navbat davom etadi
 */
export type CabinetErrorKind = 'AUTH' | 'BLOCKED' | 'RATE_LIMIT' | 'BAD_REQUEST' | 'SERVER' | 'UNKNOWN';

export class CabinetRequestError extends Error {
  readonly kind: CabinetErrorKind;
  readonly status: number | null;
  constructor(message: string, kind: CabinetErrorKind, status: number | null = null) {
    super(message);
    this.name = 'CabinetRequestError';
    this.kind = kind;
    this.status = status;
  }
  /** Shu xatoda butun navbatni to'xtatish kerakmi (aks holda faqat shu case yiqiladi)? */
  get stopsQueue(): boolean {
    return this.kind === 'AUTH' || this.kind === 'BLOCKED' || this.kind === 'RATE_LIMIT';
  }
}

function kindForStatus(status: number): CabinetErrorKind {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
}

export class CabinetApiClient {
  private baseUrl: string;
  private session: CabinetAuthSession;

  constructor(session: CabinetAuthSession, baseUrl = CABINET_BASE_URL) {
    this.session = session;
    this.baseUrl = baseUrl;
  }

  /**
   * Barcha so'rovlar uchun yagona fetch metodi
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<{ ok: boolean; status: number; data: T }> {
    const timeout = options.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'X-AUTH-TOKEN': this.session.token,
      'ngrok-skip-browser-warning': 'true',
      ...(options.customHeaders || {}),
    };

    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      // GLOBAL tezlik chegarasi — bitta case ichidagi ~7 so'rov ham shu yerdan tarqaladi
      // (avval ular ketma-ket bir zumda otilardi: aynan bloklangan naqsh).
      await paceRequest();

      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }

      if (!res.ok) {
        const errMsg = json?.message || json?.error || (typeof json === 'string' ? json : `HTTP ${res.status}`);
        throw new CabinetRequestError(
          `Cabinet API Error [${res.status}] at ${path}: ${errMsg}`,
          kindForStatus(res.status),
          res.status,
        );
      }

      return {
        ok: res.ok,
        status: res.status,
        data: (json?.data ?? json?.content ?? json) as T,
      };
    } catch (e: any) {
      if (e instanceof CabinetRequestError) throw e; // turi allaqachon aniqlangan
      if (e.name === 'AbortError') {
        // Timeout = TLS/tarmoq javob bermayapti (bloklangan holatning asosiy belgisi).
        throw new CabinetRequestError(
          `cabinetapi.sud.uz ${timeout}ms ichida javob bermadi (${path}) — tarmoq yoki portal blokda.`,
          'BLOCKED',
        );
      }
      const cause = e.cause;
      const causeStr = cause?.message || cause?.code || (typeof cause === 'object' ? JSON.stringify(cause) : String(cause || ''));
      const detail = causeStr ? ` (Sabab: ${causeStr})` : '';
      console.error(`❌ [CabinetApiClient Xatolik] URL: ${url}`);
      console.error(`   Xato: ${e.message}${detail}`);
      if (cause?.stack) {
        console.error(`   Cause Stack:`, cause.stack);
      }
      // fetch failed / ECONNREFUSED / ETIMEDOUT — hammasi tarmoq darajasi.
      throw new CabinetRequestError(`${e.message}${detail}`, 'BLOCKED');
    } finally {
      clearTimeout(timer);
    }
  }

  // GET
  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  // POST
  post<T>(path: string, body: unknown, options?: RequestOptions) {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // PUT
  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // DELETE
  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * Fayllarni multipart/form-data orqali maxsus `file_type` GUID sarlavhasi bilan yuklash
   */
  async uploadFile(fileBuffer: Buffer, fileName: string, fileTypeGuid: string): Promise<{ id: string; name: string }> {
    const fd = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' });
    fd.set('file', blob, fileName);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      await paceRequest(); // fayl yuklash ham global chegaradan o'tadi
      const res = await fetch(`${this.baseUrl}/api/cabinet/case/file/upload`, {
        method: 'POST',
        headers: {
          'X-AUTH-TOKEN': this.session.token,
          'file_type': fileTypeGuid, // Majburiy fayl turi GUID'i
          'file_name': encodeURIComponent(fileName),
          'file_size': String(fileBuffer.length),
          'mime_type': 'application/pdf',
        },
        body: fd as any,
        signal: controller.signal,
      });

      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = text; }

      if (!res.ok) {
        throw new CabinetRequestError(
          `Fayl yuklashda xatolik [${res.status}]: ${json?.message || text}`,
          kindForStatus(res.status),
          res.status,
        );
      }

      const fileId = json?.id || json?.data?.id || json?.file_id;
      if (!fileId) {
        throw new CabinetRequestError(`Fayl yuklandi, lekin portal fayl ID qaytarmadi: ${text}`, 'SERVER');
      }

      return { id: fileId, name: fileName };
    } finally {
      clearTimeout(timer);
    }
  }
}
