// MIB ijro ishining SUDYASI. MIB detalidagi sud hujjat raqami («2-1004-2606/36069-2-8916») sud ish
// raqamiga («2-1004-2606/36069») aylantiriladi va cabinet'dagi o'sha ishning sudyasi olinadi
// (ClientCaseStatus.judge — sudya sinxroni to'ldiradi, src/lib/cabinet/judge-sync.ts).
// O'qish paytida bog'lanadi — sxema o'zgarmaydi, sudya keyin topilsa darhol ko'rinadi.
import { prisma } from '../db';
import { courtCaseBase } from '../cabinet/judge-sync';

export { courtCaseBase };

export interface JudgeInfo { courtCaseNumber: string | null; judge: string | null }

/** Sud ish raqamlari → sudya (bo'sh sudyalar ham qaytadi — «cabinet'da bor, sudya hali yo'q»). */
export async function judgesByCourtCase(bases: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const uniq = [...new Set(bases.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 1000) {
    const rows = await prisma.clientCaseStatus.findMany({
      where: { source: 'CABINET', caseNumber: { in: uniq.slice(i, i + 1000) } },
      select: { caseNumber: true, judge: true },
    });
    for (const r of rows) {
      if (!r.caseNumber) continue;
      const j = (r.judge ?? '').trim() || null;
      // Bir raqam bir necha firma akkauntida bo'lishi mumkin — sudyasi borini afzal ko'ramiz.
      if (!out.has(r.caseNumber) || (j && !out.get(r.caseNumber))) out.set(r.caseNumber, j);
    }
  }
  return out;
}

/** Ishlar ro'yxatiga `courtCaseNumber` va `judge` qo'shadi (joyida emas — yangi obyektlar). */
export async function attachJudges<T extends { courtDocNumber: string | null }>(cases: T[]): Promise<(T & JudgeInfo)[]> {
  const bases = cases.map((k) => courtCaseBase(k.courtDocNumber));
  const map = await judgesByCourtCase(bases.filter((b): b is string => !!b));
  return cases.map((k, i) => ({ ...k, courtCaseNumber: bases[i], judge: bases[i] ? map.get(bases[i]!) ?? null : null }));
}

/** Mijozlar ro'yxatidagi barcha ishlarga sudya bog'laydi (bitta so'rov bilan). */
export async function attachJudgesToClients<C extends { cases: { courtDocNumber: string | null }[] }>(clients: C[]): Promise<C[]> {
  const all = clients.flatMap((c) => c.cases);
  const withJ = await attachJudges(all);
  let i = 0;
  return clients.map((c) => ({ ...c, cases: c.cases.map(() => withJ[i++]!) }));
}

/** MIB hisoboti bo'yicha sudya qamrovi (faqat bizniki ishlar). */
export async function mibJudgeCoverage(reportId: number | null): Promise<{ ours: number; linked: number; withJudge: number }> {
  const cases = await prisma.mibCase.findMany({
    where: { isTargetFirm: true, archivedAt: null, ...(reportId ? { client: { reportId } } : {}) },
    select: { courtDocNumber: true },
  });
  const bases = cases.map((k) => courtCaseBase(k.courtDocNumber));
  const map = await judgesByCourtCase(bases.filter((b): b is string => !!b));
  let linked = 0, withJudge = 0;
  for (const b of bases) { if (b && map.has(b)) { linked++; if (map.get(b)) withJudge++; } }
  return { ours: cases.length, linked, withJudge };
}
