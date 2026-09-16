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
      const res = await fetch(href, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*?=(?:UTF-8''|["'])?([^"';]+)/i);
      const fname = m ? decodeURIComponent(m[1]) : 'export.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert(t('Yuklab boʻlmadi — qayta urinib koʻring'));
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
