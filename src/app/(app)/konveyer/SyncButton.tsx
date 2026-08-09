'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ico } from '@/ui';

/** Seeds/refreshes ArizaCase rows from the latest snapshot, then refreshes the page. */
export function SyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/konveyer/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Xato');
      setMsg(data.created > 0 ? `${data.created.toLocaleString('ru-RU')} yangi mijoz qo'shildi` : 'Yangilandi — hammasi joyida');
      start(() => router.refresh());
    } catch (e: any) {
      setMsg(e?.message ?? 'Xato');
    } finally {
      setBusy(false);
    }
  };

  const loading = busy || pending;
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button onClick={run} disabled={loading} className="btn-primary">
        <Ico.undo size={16} />
        {loading ? 'Yangilanmoqda…' : "Snapshot'dan yangilash"}
      </button>
    </div>
  );
}
