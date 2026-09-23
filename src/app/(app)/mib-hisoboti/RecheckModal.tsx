'use client';

// «PINFL allaqachon tekshirilgan — qayta olamizmi?» modal. window.confirm() o'rniga: sana + ish soni
// + arxiv izohi + dark-mode qulay ranglar + focus trap (Modal komponentida). Uchta joydan
// ishlatiladi: MibReport (bitta PINFL forma), MibDashboard (dashboarddagi PINFL), ClientDetailFull
// («Qayta tekshirish» tugmasi).
import React, { useEffect, useState } from 'react';
import { Modal, Ico, Spinner } from '@/ui';
import { useT } from '@/lib/i18n/client';

export interface RecheckInfo {
  pinfl: string;
  lastCheckedAt: string | Date | null;
  cases?: number; // faol ish soni (ilgari tekshirilganдан)
}

export function RecheckModal({
  open, info, onClose, onConfirm, onKeepOld,
}: {
  open: boolean;
  info: RecheckInfo | null;
  onClose: () => void;
  onConfirm: () => Promise<void> | void; // «Ha, yangi olamiz» — force=true, arxivga ko'chiradi
  onKeepOld?: () => void; // «Yo'q, eski natijani ko'ramiz» — mavjud sahifa
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const dt = info?.lastCheckedAt
    ? new Date(info.lastCheckedAt).toLocaleString('ru-RU', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : t('nomaʼlum sana');

  const doConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open && !!info}
      onClose={busy ? () => { /* busy — yopilmaydi */ } : onClose}
      size="md"
      title={t('Bu PINFL allaqachon tekshirilgan')}
      description={undefined}
      footer={info ? (
        <>
          {onKeepOld && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { onKeepOld(); onClose(); }}
              className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50"
            >
              {t('Eski natijaga oʻtish')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50"
          >
            {t('Bekor')}
          </button>
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={doConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm outline-none transition-colors hover:bg-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60"
          >
            {busy ? <Spinner size={14} /> : <Ico.refresh size={14} />}
            {t('Yangi dalniy olamiz')}
          </button>
        </>
      ) : null}
    >
      {info ? (
        <div className="space-y-4">
          {/* PINFL kartochka: mono-space, ajratilgan tabular */}
          <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
            <div className="text-xs uppercase tracking-wide text-muted">{t('PINFL')}</div>
            <div className="mt-1 font-mono text-base tabular-nums tracking-[0.06em] text-fg">{info.pinfl}</div>
          </div>

          {/* Sana + ish soni qatorlari */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2/30 p-3.5">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                <Ico.calendar size={12} /> {t('Oxirgi tekshiruv')}
              </div>
              <div className="mt-1 text-sm font-medium text-fg">{dt}</div>
            </div>
            {typeof info.cases === 'number' && (
              <div className="rounded-xl border border-line bg-surface-2/30 p-3.5">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                  <Ico.layer size={12} /> {t('Faol ishlar')}
                </div>
                <div className="mt-1 text-sm font-medium text-fg tabular-nums">
                  {info.cases} {t('ta')}
                </div>
              </div>
            )}
          </div>

          {/* Info banner: arxiv siyosati */}
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3.5 text-sm">
            <Ico.archive size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="text-amber-800 dark:text-amber-200/90">
              <b>{t('Eski natija arxivga oʻtadi')}</b> — {t('yoʻqolmaydi, mijoz sahifasidagi «Arxiv» tugmasi orqali koʻrish mumkin. Yangi tekshiruv mib.uz’dan bir necha soniyada olib beriladi (chuqur detal — SMS orqali).')}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
