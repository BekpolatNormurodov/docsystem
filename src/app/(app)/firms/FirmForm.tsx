'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Firm } from '@prisma/client';
import { Modal, TextField, RowAction, Ico } from '@/ui';

type FirmFields = Record<
  'shortName' | 'legalName' | 'address' | 'bankAccount' | 'mfo' | 'stir' | 'postIndex' | 'phone',
  string
>;

function toFields(firm: Firm): FirmFields {
  return {
    shortName: firm.shortName,
    legalName: firm.legalName ?? '',
    address: firm.address ?? '',
    bankAccount: firm.bankAccount ?? '',
    mfo: firm.mfo ?? '',
    stir: firm.stir ?? '',
    postIndex: firm.postIndex ?? '',
    phone: firm.phone ?? '',
  };
}

/** One firm's row — its own edit-modal state, so the list page stays a plain server component. */
export function FirmRow({ firm }: { firm: Firm }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-t border-line">
        <td className="px-4 py-3 align-top font-mono text-xs">{firm.code}</td>
        <td className="px-4 py-3 align-top">
          <div className="truncate font-medium" title={firm.legalName ?? firm.shortName}>
            {firm.shortName}
          </div>
        </td>
        <td className="px-4 py-3 align-top text-muted">{firm.stir || '—'}</td>
        <td className="px-4 py-3 align-top font-mono text-xs text-muted">{firm.bankAccount || '—'}</td>
        <td className="px-4 py-3 text-right align-top">
          <RowAction onClick={() => setOpen(true)} label="Tahrirlash">
            <Ico.pen size={16} />
          </RowAction>
        </td>
      </tr>
      {open && <FirmForm firm={firm} onClose={() => setOpen(false)} />}
    </>
  );
}

function FirmForm({ firm, onClose }: { firm: Firm; onClose: () => void }) {
  const router = useRouter();
  const [fields, setFields] = useState<FirmFields>(() => toFields(firm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FirmFields>(key: K) {
    return (v: string) => setFields((f) => ({ ...f, [key]: v }));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/firms/${firm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        setError("Saqlashda xatolik yuz berdi");
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={firm.shortName}
      description={`Kod: ${firm.code}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} type="button">
            Bekor qilish
          </button>
          <button className="btn-primary" onClick={onSave} disabled={saving} type="button">
            {saving ? 'Saqlanmoqda...' : 'Saqlash'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Qisqa nomi" value={fields.shortName} onChange={set('shortName')} className="sm:col-span-2" />
        <TextField label="Toʻliq yuridik nomi" value={fields.legalName} onChange={set('legalName')} className="sm:col-span-2" />
        <TextField label="Manzil" value={fields.address} onChange={set('address')} className="sm:col-span-2" />
        <TextField label="Hisob raqami (X/R)" value={fields.bankAccount} onChange={set('bankAccount')} />
        <TextField label="MFO" value={fields.mfo} onChange={set('mfo')} />
        <TextField label="STIR" value={fields.stir} onChange={set('stir')} />
        <TextField label="Pochta indeksi" value={fields.postIndex} onChange={set('postIndex')} />
        <TextField label="Telefon" value={fields.phone} onChange={set('phone')} />
      </div>
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{error}</p>}
    </Modal>
  );
}
