// MIB avtomator loglari — jarayon ichidagi halqa-bufer (ring buffer). runMibReportJob web
// jarayonida INLINE ishlaydi, shuning uchun shu buferga yozilgan loglarni web /api/mib/logs orqali
// jonli ko'rsatib turadi. Bufer restartda tozalanadi (jonli tomosha uchun yetarli), DB kerak emas.
// Har qator qaysi hisobot run'iga tegishli ekani (`r`) bilan saqlanadi — monitor bitta hisobotni ko'radi.
export interface MibLogLine { id: number; ts: number; msg: string; r?: number }

const CAP = 4000;
const BUF: MibLogLine[] = [];
let seq = 0;

export function pushMibLog(msg: string, reportId?: number): void {
  seq += 1;
  BUF.push({ id: seq, ts: Date.now(), msg, ...(reportId ? { r: reportId } : {}) });
  if (BUF.length > CAP) BUF.splice(0, BUF.length - CAP);
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
