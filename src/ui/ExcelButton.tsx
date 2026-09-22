'use client';

// Excel/hujjat yuklab olish tugmasi — LOADING bilan. Oddiy <a download> bosilганда server faylni
// yasagunча (bir necha soniya) hech qanday belgи yo'q edi; bu tugma fetch→blob orqali yuklaydi va
// shu orada spinner ko'rsatadi. Matn i18n (useT) bilan — source-string kaliti bo'yicha.
import React, { useState } from 'react';
import { Ico } from './icons';
import { Spinner } from './Spinner';
import { useT } from '@/lib/i18n/client';

export function ExcelButton({ href, label, title, className }: { href: string; label: string; title?: string; className?: string }) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      // `redirect: 'error'` — server auth guard (requireAccess) redirect qilsa fetch
      // login/landing HTMLi'ni ergashib olib, uni «export.xlsx» sifatida saqlab qo'yardi
      // (ochib bo'lmaydigan fayl). Endi redirect'ni error qilamiz.
      const res = await fetch(href, { cache: 'no-store', redirect: 'error' });
      if (!res.ok) throw new Error(`http_${res.status}`);
      // Content-Type xlsx bo'lmasa (masalan HTML: guard'ga bog'liq 200 lekin sahifa), fayl ochilmaydi.
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      const isXlsx = ct.includes('spreadsheet') || ct.includes('excel') || ct.includes('octet-stream');
      if (!isXlsx) throw new Error('not_xlsx');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      // RFC 5987 (filename*=UTF-8''…) yoki oddiy `filename="…"`. Ikkalasi ham qo'llab-quvvatlanadi.
      const m5987 = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const mPlain = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
      // href pathining oxirgi qismini fallback qilib olamiz, aks holda «export.xlsx».
      const urlName = href.split('?')[0].split('/').filter(Boolean).pop() || 'export';
      const fname = m5987 ? decodeURIComponent(m5987[1])
        : mPlain ? (() => { try { return decodeURIComponent(mPlain[1].trim()); } catch { return mPlain[1].trim(); } })()
        : `${urlName}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'not_xlsx' || code === 'failed') {
        alert(t('Yuklab boʻlmadi — sizga bu eksport uchun ruxsat yoʻq yoki sessiya tugagan. Sahifani yangilang va qayta kiring.'));
      } else {
        alert(t('Yuklab boʻlmadi — qayta urinib koʻring'));
      }
    } finally {
      setLoading(false);
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={loading} title={title ? t(title) : undefined}
      aria-busy={loading} className={`btn-ghost shrink-0 disabled:opacity-60 ${className ?? ''}`}>
      {loading ? <Spinner size={16} /> : <Ico.download size={16} />} {loading ? t('Tayyorlanmoqda…') : t(label)}
    </button>
  );
}
