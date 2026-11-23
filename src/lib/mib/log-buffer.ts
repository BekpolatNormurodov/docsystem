// MIB avtomator loglari — jarayon ichidagi halqa-bufer (ring buffer) + HISOBOT bo'yicha diskdagi jurnal.
// runMibReportJob web jarayonida INLINE ishlaydi: bufer jonli quyruq uchun (/api/mib/logs poll qiladi),
// disk jurnali (storage/mib-reports/<id>/run.log — volume, deploy/restartda saqlanadi) esa monitor
// ochilganda OLDINGI run'lar loglarini ham ko'rsatish uchun: pauza/restartdan keyin log «bo'shab» qolmasin.
import fs from 'node:fs';
import path from 'node:path';
import { mibReportDir } from './store';

export interface MibLogLine { id: number; ts: number; msg: string; r?: number }

const CAP = 4000;
const BUF: MibLogLine[] = [];
let seq = 0;

// Jurnal: har hisobotga bitta fayl, JSON qatorlar. Yozish navbat bilan (tartib buzilmasin), xato — jim.
const JOURNAL_MAX = 6 * 1024 * 1024; // shundan oshsa oxirgi yarmi qoldiriladi
const chain = new Map<number, Promise<void>>();
const journalPath = (reportId: number) => path.join(mibReportDir(reportId), 'run.log');
function journal(reportId: number, line: MibLogLine): void {
  const p = journalPath(reportId);
  const prev = chain.get(reportId) ?? Promise.resolve();
  const next = prev.then(async () => {
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.appendFile(p, JSON.stringify({ ts: line.ts, msg: line.msg }) + '\n');
    if (line.id % 500 === 0) {
      const st = await fs.promises.stat(p).catch(() => null);
      if (st && st.size > JOURNAL_MAX) {
        const buf = await fs.promises.readFile(p);
        const cut = buf.indexOf(10, buf.length - JOURNAL_MAX / 2);
        await fs.promises.writeFile(p, buf.subarray(cut + 1));
      }
    }
  }).catch(() => {});
  chain.set(reportId, next);
}

export function pushMibLog(msg: string, reportId?: number): void {
  seq += 1;
  const line: MibLogLine = { id: seq, ts: Date.now(), msg, ...(reportId ? { r: reportId } : {}) };
  BUF.push(line);
  if (BUF.length > CAP) BUF.splice(0, BUF.length - CAP);
  if (reportId) journal(reportId, line);
}

/** Jurnal oxiridan `limit` ta qator (`beforeTs` dan oldingilari) — id manfiy (buferdagilar bilan to'qnashmasin). */
async function journalTail(reportId: number, limit: number, beforeTs: number): Promise<MibLogLine[]> {
  const p = journalPath(reportId);
  try {
    const fh = await fs.promises.open(p, 'r');
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 1024 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const rows = buf.toString('utf8').split('\n');
      if (len < size) rows.shift(); // birinchi qator kesilgan bo'lishi mumkin
      const out: MibLogLine[] = [];
      for (const r of rows) {
        if (!r) continue;
        try { const o = JSON.parse(r) as { ts: number; msg: string }; if (o.ts < beforeTs) out.push({ id: 0, ts: o.ts, msg: o.msg, r: reportId }); } catch { /* buzuq qator */ }
      }
      return out.slice(-limit).map((l, i, a) => ({ ...l, id: -(a.length - i) }));
    } finally { await fh.close(); }
  } catch { return []; }
}

/** afterId dan keyingi loglar. `q` — substring (masalan PINFL); `reportId` — faqat o'sha run + umumiy
 *  (hisobotsiz, masalan ulanish tekshiruvi) qatorlar. */
export function getMibLogs(afterId = 0, q?: string, limit = 400, reportId?: number): { lines: MibLogLine[]; lastId: number } {
  let lines = BUF.filter((l) => l.id > afterId);
  if (reportId) lines = lines.filter((l) => !l.r || l.r === reportId);
  if (q) { const needle = q.trim(); if (needle) lines = lines.filter((l) => l.msg.includes(needle)); }
  if (lines.length > limit) lines = lines.slice(lines.length - limit);
  return { lines, lastId: seq };
}

/** Monitor birinchi ochilganda: diskdagi oldingi loglar + buferdagi joriylari (takrorsiz), oxirgi `limit` ta. */
export async function getMibLogsWithHistory(reportId: number, limit = 1500): Promise<{ lines: MibLogLine[]; lastId: number }> {
  const live = getMibLogs(0, undefined, limit, reportId);
  const firstTs = live.lines.find((l) => l.r === reportId)?.ts ?? Date.now() + 1;
  const old = live.lines.length < limit ? await journalTail(reportId, limit - live.lines.length, firstTs) : [];
  return { lines: [...old, ...live.lines], lastId: live.lastId };
}
