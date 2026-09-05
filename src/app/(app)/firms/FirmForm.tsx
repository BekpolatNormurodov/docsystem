'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Firm, FirmDocKind } from '@prisma/client';
import { Modal, TextField, Select, RowAction, Ico } from '@/ui';
import { BILLING_REGIONS, BILLING_VILOYATS } from '@/core/billing-regions-data';

type FirmFields = Record<
  | 'shortName' | 'legalName' | 'address' | 'bankAccount' | 'mfo' | 'stir' | 'postIndex' | 'phone'
  | 'region' | 'district' | 'addressLine',
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
    region: firm.region ?? '',
    district: firm.district ?? '',
    addressLine: firm.addressLine ?? '',
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

  // Viloyat o'zgarsa — tuman shu viloyatga tegishli bo'lmasa tozalanadi (kaskad).
  function setRegion(v: string) {
    setFields((f) => {
      const tumans = BILLING_REGIONS[v] ?? [];
      return { ...f, region: v, district: tumans.includes(f.district) ? f.district : '' };
    });
  }

  const tumanOptions = (BILLING_REGIONS[fields.region] ?? []).map((t) => ({ value: t, label: t }));

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
        <Select
          label="Viloyat (billing)"
          value={fields.region}
          onChange={setRegion}
          placeholder="Viloyatni tanlang"
          options={BILLING_VILOYATS.map((v) => ({ value: v, label: v }))}
        />
        <Select
          label="Tuman (billing)"
          value={fields.district}
          onChange={set('district')}
          placeholder={fields.region ? 'Tumanni tanlang' : 'Avval viloyatni tanlang'}
          options={tumanOptions}
        />
        <TextField label="Koʻcha/uy (billing manzil)" value={fields.addressLine} onChange={set('addressLine')} className="sm:col-span-2" />
        <TextField label="Hisob raqami (X/R)" value={fields.bankAccount} onChange={set('bankAccount')} />
        <TextField label="MFO" value={fields.mfo} onChange={set('mfo')} />
        <TextField label="STIR" value={fields.stir} onChange={set('stir')} />
        <TextField label="Pochta indeksi" value={fields.postIndex} onChange={set('postIndex')} />
        <TextField label="Telefon" value={fields.phone} onChange={set('phone')} />
      </div>
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{error}</p>}

      <FirmDocs firmId={firm.id} />
    </Modal>
  );
}

// Sanoat palatasi hujjatlari — har firma uchun bittadan (guvohnoma/ishonchnoma/shartnoma).
// Bular sud paketiga qo'shiladi. Backend: /konveyer/firm-doc (GET/POST/DELETE, admin).
const DOC_KINDS: { kind: FirmDocKind; label: string }[] = [
  { kind: 'GUVOHNOMA', label: 'Guvohnoma' },
  { kind: 'ISHONCHNOMA', label: 'Ishonchnoma' },
  { kind: 'SHARTNOMA', label: 'Shartnoma' },
];

function FirmDocs({ firmId }: { firmId: number }) {
  const [docs, setDocs] = useState<Record<string, { id: number; label: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/konveyer/firm-doc?firmId=${firmId}`, { cache: 'no-store' });
      const d = await r.json();
      const map: Record<string, { id: number; label: string | null }> = {};
      for (const x of (d.docs ?? []) as { id: number; kind: string; label: string | null }[]) map[x.kind] = { id: x.id, label: x.label };
      setDocs(map);
    } catch { setErr('Hujjatlarni yuklab boʻlmadi'); }
    finally { setLoading(false); }
  }, [firmId]);
  useEffect(() => { load(); }, [load]);

  async function upload(kind: string, file: File) {
    setBusy(kind); setErr(null);
    try {
      const fd = new FormData();
      fd.append('firmId', String(firmId));
      fd.append('kind', kind);
      fd.append('file', file);
      const r = await fetch('/konveyer/firm-doc', { method: 'POST', body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error || 'Yuklab boʻlmadi'); }
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Xato'); }
    finally { setBusy(null); }
  }

  async function remove(kind: string, id: number) {
    setBusy(kind); setErr(null);
    try {
      const r = await fetch(`/konveyer/firm-doc?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      await load();
    } catch { setErr('Oʻchirib boʻlmadi'); }
    finally { setBusy(null); }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Ico.files size={16} /> Hujjatlar <span className="text-xs font-normal text-muted">(sud paketiga qoʻshiladi)</span>
      </div>
      {err && <p className="mb-2 text-xs text-rose-600 dark:text-rose-300">{err}</p>}
      <div className="space-y-1.5">
        {DOC_KINDS.map(({ kind, label }) => {
          const doc = docs[kind];
          const isBusy = busy === kind;
          return (
            <div key={kind} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
              <span className="w-28 shrink-0 text-[13px] font-medium">{label}</span>
              {loading ? (
                <span className="text-xs text-muted">…</span>
              ) : doc ? (
                <>
                  <a href={`/konveyer/firm-doc?download=${doc.id}`} className="min-w-0 flex-1 truncate text-[12px] text-brand-600 hover:underline dark:text-brand-400" title={doc.label ?? label}>
                    {doc.label ?? label}
                  </a>
                  <button type="button" disabled={isBusy} onClick={() => inputs.current[kind]?.click()} className="btn-ghost px-2 py-1 text-[11px]">Almashtirish</button>
                  <button type="button" disabled={isBusy} onClick={() => remove(kind, doc.id)} className="px-2 py-1 text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-300">{isBusy ? '…' : 'Oʻchirish'}</button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-[12px] text-muted">yuklanmagan</span>
                  <button type="button" disabled={isBusy} onClick={() => inputs.current[kind]?.click()} className="btn-primary px-2.5 py-1 text-[11px]">{isBusy ? 'Yuklanmoqda…' : 'Yuklash'}</button>
                </>
              )}
              <input
                ref={(el) => { inputs.current[kind] = el; }}
                type="file"
                accept=".pdf,.docx,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(kind, f); e.target.value = ''; }}
              />
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">Har firma uchun bittadan (yangi yuklama eskisini almashtiradi). PDF/DOCX/rasm, ≤25MB.</p>
    </div>
  );
}
