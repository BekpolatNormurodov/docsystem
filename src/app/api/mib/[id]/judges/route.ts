// MIB hisoboti — «Sudyalarni topish». GET: shu hisobot bizniki ishlarining sudya qamrovi + sudya
// sinxronining jonli holati. POST: worker'ga so'rov (shu hisobot ishlari BIRINCHI tekshiriladi).
// id = 0 — «Umumiy» (barcha hisobotlar).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { mibJudgeCoverage } from '@/lib/mib/judges';
import { readJudgeState, judgeStateAlive, requestJudgeSync, JUDGE_SYNC_REQUEST } from '@/lib/cabinet/judge-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id) || 0;
  const [cov, st, req] = await Promise.all([
    mibJudgeCoverage(id > 0 ? id : null),
    readJudgeState(),
    prisma.setting.findUnique({ where: { key: JUDGE_SYNC_REQUEST }, select: { value: true } }),
  ]);
  let retryAt: string | null = null;
  if (req?.value) { try { retryAt = JSON.parse(req.value).retryAt ?? null; } catch { /* */ } }
  return NextResponse.json({
    ...cov,
    running: judgeStateAlive(st),
    queued: !!req?.value,
    retryAt,
    progress: { total: st.total, done: st.done, found: st.found, failed: st.failed, firm: st.firm },
    forThisReport: st.mibReportId === (id > 0 ? id : null),
    finishedAt: st.finishedAt,
    note: st.note,
  });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id) || 0;
  await requestJudgeSync(id > 0 ? id : null);
  return NextResponse.json({ ok: true });
}
