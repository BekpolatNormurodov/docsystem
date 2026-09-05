// cabinet-api-skeleton/client.ts
// cabinet.sud.uz (cabinetapi.sud.uz) uchun xavfsiz va ishonchli REST mijozi.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { CABINET_BASE_URL } from './constants';
import type { CabinetAuthSession } from './types';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
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
        throw new Error(`Cabinet API Error [${res.status}] at ${path}: ${errMsg}`);
      }

      return {
        ok: res.ok,
        status: res.status,
        data: (json?.data ?? json?.content ?? json) as T,
      };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new Error(`Cabinet API Timeout: ${path} ${timeout}ms ichida javob bermadi.`);
      }
      const cause = e.cause;
      const causeStr = cause?.message || cause?.code || (typeof cause === 'object' ? JSON.stringify(cause) : String(cause || ''));
      const detail = causeStr ? ` (Sabab: ${causeStr})` : '';
      console.error(`❌ [CabinetApiClient Xatolik] URL: ${url}`);
      console.error(`   Xato: ${e.message}${detail}`);
      if (cause?.stack) {
        console.error(`   Cause Stack:`, cause.stack);
      }
      throw new Error(`${e.message}${detail}`);
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
        throw new Error(`Fayl yuklashda xatolik [${res.status}]: ${json?.message || text}`);
      }

      const fileId = json?.id || json?.data?.id || json?.file_id;
      if (!fileId) {
        throw new Error(`Fayl yuklandi, lekin portal fayl ID qaytarmadi: ${text}`);
      }

      return { id: fileId, name: fileName };
    } finally {
      clearTimeout(timer);
    }
  }
}
