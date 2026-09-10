// MIB avtomator loglari — jarayon ichidagi halqa-bufer (ring buffer). runMibReportJob web
// jarayonida INLINE ishlaydi, shuning uchun shu buferga yozilgan loglarni web /api/mib/logs orqali
// jonli ko'rsatib turadi. Bufer restartda tozalanadi (jonli tomosha uchun yetarli), DB kerak emas.
export interface MibLogLine { id: number; ts: number; msg: string }

const CAP = 1000;
const BUF: MibLogLine[] = [];
let seq = 0;

export function pushMibLog(msg: string): void {
  seq += 1;
  BUF.push({ id: seq, ts: Date.now(), msg });
  if (BUF.length > CAP) BUF.splice(0, BUF.length - CAP);
}

/** afterId dan keyingi loglar (ixtiyoriy `q` substring filtri bilan, masalan PINFL). */
export function getMibLogs(afterId = 0, q?: string, limit = 400): { lines: MibLogLine[]; lastId: number } {
  let lines = BUF.filter((l) => l.id > afterId);
  if (q) { const needle = q.trim(); if (needle) lines = lines.filter((l) => l.msg.includes(needle)); }
  if (lines.length > limit) lines = lines.slice(lines.length - limit);
  return { lines, lastId: seq };
}
