'use client';

// MIB avtomator logini WEB'da jonli ko'rsatadi (/api/mib/logs quyrug'ini poll qiladi). `q` berilsa
// (masalan mijoz PINFL'i) — faqat o'sha bo'yicha loglar. Tekshiruv nima qilayotganini (SMS so'raldi,
// kod keldi/kelmadi, xato...) shu yerda ko'rinadi.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '@/ui';

interface Line { id: number; ts: number; msg: string }
const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function MibLogPanel({ q, title = 'Avtomator logi', defaultOpen = true }: { q?: string; title?: string; defaultOpen?: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState(defaultOpen);
  const lastId = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    const url = `/api/mib/logs?after=${lastId.current}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const j = await fetch(url, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!j || typeof j.lastId !== 'number') return;
    // Server restart bo'lsa (deploy) seq 0 dan boshlanadi — kursor orqaga ketsa qaytadan o'qiymiz.
    if (j.lastId < lastId.current) { lastId.current = 0; setLines([]); return; }
    if (Array.isArray(j.lines) && j.lines.length) {
      setLines((prev) => {
        const have = new Set(prev.map((l) => l.id));
        const fresh = j.lines.filter((l: Line) => !have.has(l.id)); // dublikat kalitlar bo'lmasin
        return fresh.length ? [...prev, ...fresh].slice(-500) : prev;
      });
    }
    lastId.current = j.lastId;
  }, [q]);

  // Ish boshlanganда (defaultOpen true bo'lsa) panel o'zi ochilsin (lekin qo'lда yopganni majburlamaymiz).
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  // Bir marta boshlang'ich o'qish + ochiq turганда har 2.5s (yopiq bo'lsa trafik sarflamaymiz).
  useEffect(() => { void poll(); }, [poll]);
  useEffect(() => { if (!open) return; const t = setInterval(() => void poll(), 2500); return () => clearInterval(t); }, [open, poll]);
  useEffect(() => { if (open && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines, open]);

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Ico.info size={15} className="text-brand-600 dark:text-brand-400" /> {title}
          <span className="badge border-line text-muted tabular-nums">{lines.length}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="flex h-2 w-2"><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
          <span className="text-xs text-muted">jonli</span>
          <svg className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        </span>
      </button>
      {open && (
        <div ref={box} className="max-h-64 overflow-auto border-t border-line bg-slate-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-200">
          {lines.length === 0
            ? <div className="py-6 text-center text-slate-500">Hozircha log yoʻq. Tekshiruv ketganda shu yerda koʻrinadi.</div>
            : lines.map((l) => (
              <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-words">
                <span className="shrink-0 tabular-nums text-slate-500">{hhmmss(l.ts)}</span>
                <span className={l.msg.includes('XATO') || l.msg.toUpperCase().includes('KELMADI') ? 'text-rose-400' : l.msg.includes('keldi') || l.msg.includes('tayyor') || l.msg.includes('ijro ishi') ? 'text-emerald-300' : 'text-slate-200'}>{l.msg}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
