'use client';
import { useCallback, useEffect, useState } from 'react';

// 24/7 AVTOMAT QORALAMA — boshqaruv + monitoring (sud bo'limi, admin).
//
// «Go» yoqilsa worker to'xtovsiz tayyor ishlarga qoralama tayyorlaydi (firma-ketma-firma,
// sud sozlamasidagi interval bilan, 24/7). Panel: yoqilgan-o'chirilgani, hozir qaysi firma
// ketmoqda, va firma/sud kesimida nechta qoralama tayyor / sudda / navbatda.

const n = (x: number) => x.toLocaleString('ru-RU');

interface Tally { total: number; draftReady: number; submitted: number; queued: number }
interface FirmRow extends Tally { firmId: number; firmName: string; sendable: number; active: boolean; paused: boolean }
interface CourtRow extends Tally { courtId: number; courtName: string; sendable: number }
interface Status {
  on: boolean;
  active: { jobId: number; status: string; progress: number; total: number; firmName: string | null; draftMode: boolean; message: string | null } | null;
  firms: FirmRow[];
  courts: CourtRow[];
}

function Bar({ ready, submitted, total }: { ready: number; submitted: number; total: number }) {
  const rp = total ? Math.round((ready / total) * 100) : 0;
  const sp = total ? Math.round((submitted / total) * 100) : 0;
  return (
    <span className="flex h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <span className="h-full bg-indigo-500" style={{ width: `${sp}%` }} />
      <span className="h-full bg-teal-500" style={{ width: `${rp}%` }} />
    </span>
  );
}

export default function DraftAutoPanel() {
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/konveyer/court-draft-auto', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'holat o‘qilmadi');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/konveyer/court-draft-auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !data.on }),
      });
      if (r.ok) { const d = await r.json(); setData((p) => (p ? { ...p, on: d.on === true } : p)); }
    } catch { /* tarmoq — holat o'zgarmaydi */ } finally { setBusy(false); void load(); }
  };

  // Bitta firmani to'xtatish/davom ettirish (umumiy «Go»dan mustaqil). Pauzaga qo'yilgan firma
  // avto-qoralamada chetlab o'tiladi — boshqa firmalar ketaveradi.
  const [firmBusy, setFirmBusy] = useState<number | null>(null);
  const toggleFirm = async (firmId: number, paused: boolean) => {
    if (firmBusy) return;
    setFirmBusy(firmId);
    // Optimistik: darhol ko'rsatamiz.
    setData((p) => (p ? { ...p, firms: p.firms.map((f) => (f.firmId === firmId ? { ...f, paused: !paused } : f)) } : p));
    try {
      await fetch('/konveyer/court-queue/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !paused, firmId }),
      });
    } catch { /* tarmoq — keyingi pollда to'g'rilanadi */ } finally { setFirmBusy(null); void load(); }
  };

  if (!data && !err) return null;
  const on = data?.on === true;
  const active = data?.active ?? null;
  const totalDraftReady = (data?.firms ?? []).reduce((s, f) => s + f.draftReady, 0);
  // «Tayyor» = hujjati to'liq, hali qoralama/yuborilmagan — «Go»da AYNAN shular qoralama qilinadi.
  const totalSendable = (data?.firms ?? []).reduce((s, f) => s + (f.sendable ?? 0), 0);

  return (
    <div className={`rounded-xl border transition-colors ${on ? 'border-teal-500/45 bg-teal-500/[0.05]' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500/70" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${on ? 'bg-teal-500' : 'bg-slate-400'}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[13px] font-semibold ${on ? 'text-teal-700 dark:text-teal-300' : 'text-fg'}`}>
              24/7 avtomat qoralama {on ? '— ishlamoqda' : '— o‘chiq'}
            </span>
            {totalSendable > 0 && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-300" title="Hujjati to‘liq, hali qoralama qilinmagan — «Go»da shular tayyorlanadi">
                {n(totalSendable)} tayyor
              </span>
            )}
            {totalDraftReady > 0 && (
              <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-teal-700 dark:text-teal-300">
                {n(totalDraftReady)} qoralama tayyor
              </span>
            )}
            {active && (
              <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                {active.firmName}: {n(active.progress)}/{n(active.total)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            {on
              ? `Tayyor ishlarga to‘xtovsiz qoralama tayyorlanmoqda (firma-ketma-firma, sud sozlamasidagi interval). Yurist portalda o‘zi yuboradi.${totalSendable > 0 ? ` Yana ${n(totalSendable)} ta tayyor — navbatda.` : ' Hammasi tayyorlandi.'}`
              : `Yoqilsa, tizim ${totalSendable > 0 ? `${n(totalSendable)} ta tayyor ishni` : 'tayyor ishlarni'} 24/7 qoralama qilib tayyorlaydi — real sudga yubormaydi, faqat ADOLAT‘da to‘liq qoralama qoldiradi. Umumiy «Sudga yuborish» pauzasi buni to‘xtatmaydi.`}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy || !data}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 disabled:opacity-50 ${
            on
              ? 'border-rose-500/45 text-rose-600 hover:bg-rose-500/10 focus-visible:ring-rose-500/30 dark:text-rose-300'
              : 'border-teal-500/50 bg-teal-500/10 text-teal-700 hover:bg-teal-500/[0.18] focus-visible:ring-teal-500/30 dark:text-teal-300'
          }`}
        >
          {busy ? '…' : on ? 'To‘xtatish' : 'Go — 24/7'}
        </button>
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted outline-none transition-colors hover:border-teal-500/40 hover:text-fg focus-visible:ring-2 focus-visible:ring-teal-500/30">
          Monitoring
          <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {open && data && (
        <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
          {/* FIRMA kesimida */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted">
              <span>Firma kesimida</span>
              <span className="ml-auto flex items-center gap-2 text-[10px] font-normal">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />tayyor</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-500" />qoralama</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />sudda</span>
              </span>
            </div>
            <ul className="space-y-1">
              {data.firms.map((f) => (
                <li key={f.firmId} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${f.paused ? 'bg-rose-500/[0.06] opacity-70' : f.active ? 'bg-sky-500/[0.06]' : 'bg-surface-2'}`}>
                  <button
                    onClick={() => toggleFirm(f.firmId, f.paused)}
                    disabled={firmBusy === f.firmId}
                    title={f.paused ? 'Bu firmani davom ettirish' : 'Bu firmani to‘xtatish (boshqalari ketaveradi)'}
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded outline-none transition-colors focus-visible:ring-2 disabled:opacity-40 ${f.paused ? 'text-rose-600 hover:bg-rose-500/15 focus-visible:ring-rose-500/30 dark:text-rose-300' : 'text-muted hover:bg-surface hover:text-fg focus-visible:ring-teal-500/30'}`}
                  >
                    {f.paused
                      ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                      : <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>}
                  </button>
                  <span className={`min-w-0 flex-1 truncate font-medium ${f.paused ? 'text-muted' : ''}`} title={f.firmName}>{f.firmName}{f.active && !f.paused && ' ·'}</span>
                  {f.paused && <span className="shrink-0 rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-medium text-rose-700 dark:text-rose-300">pauza</span>}
                  <Bar ready={f.draftReady} submitted={f.submitted} total={f.total} />
                  <span className="w-8 shrink-0 text-right tabular-nums text-amber-600 dark:text-amber-400" title="Tayyor — qoralama qilinadi">{n(f.sendable)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-teal-600 dark:text-teal-400" title="Qoralama tayyor">{n(f.draftReady)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-indigo-600 dark:text-indigo-400" title="Sudda">{n(f.submitted)}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* SUD kesimida */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-muted">
              <span>Sud kesimida</span>
              <span className="ml-auto flex items-center gap-2 text-[10px] font-normal">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />tayyor</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-500" />qoralama</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />sudda</span>
              </span>
            </div>
            <ul className="space-y-1">
              {data.courts.length === 0 && <li className="rounded-lg bg-surface-2 px-2 py-1.5 text-[11px] text-muted">Sud biriktirilmagan</li>}
              {data.courts.map((c) => (
                <li key={c.courtId} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-medium" title={c.courtName}>{c.courtName}</span>
                  <Bar ready={c.draftReady} submitted={c.submitted} total={c.total} />
                  <span className="w-8 shrink-0 text-right tabular-nums text-amber-600 dark:text-amber-400" title="Tayyor — qoralama qilinadi">{n(c.sendable)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-teal-600 dark:text-teal-400" title="Qoralama tayyor">{n(c.draftReady)}</span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-indigo-600 dark:text-indigo-400" title="Sudda">{n(c.submitted)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
