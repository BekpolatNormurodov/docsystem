// MIB hisoboti — «Sudyalarni topish». GET: shu hisobot bizniki ishlarining sudya qamrovi + sudya
// sinxronining jonli holati. POST: worker'ga so'rov (shu hisobot ishlari BIRINCHI tekshiriladi).
// id = 0 — «Umumiy» (barcha hisobotlar).
import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { mibJudgeCoverage } from '@/lib/mib/judges';
import { readJudgeState, judgeStateAlive, requestMibJudgeSync, readMibJudgeRequest } from '@/lib/cabinet/judge-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id) || 0;
  const [cov, st, mibReq] = await Promise.all([
    mibJudgeCoverage(id > 0 ? id : null),
    readJudgeState(),
    readMibJudgeRequest(),
  ]);
  const alive = judgeStateAlive(st);
  // Joriy yurish shu hisobot uchunmi: alohida MIB yurishi (shu hisobot yoki «barcha MIB») yoki
  // umumiy yurish (u ham MIB ishlarini birinchi oladi).
  const mine = st.scope === 'mib' ? (st.mibReportIds.includes(0) || st.mibReportIds.includes(id) || id === 0) : true;
  const queuedMine = !!mibReq && (mibReq.reportIds.includes(0) || mibReq.reportIds.includes(id) || id === 0);
  return NextResponse.json({
    ...cov,
    running: alive && mine,
    scope: st.scope,                                  // 'mib' — alohida (faqat MIB ishlari), 'all' — umumiy
    queued: queuedMine,
    retryAt: queuedMine ? mibReq!.retryAt : null,
    progress: { total: st.total, done: st.done, found: st.found, failed: st.failed, firm: st.firm },
    finishedAt: st.finishedAt,
    note: st.note,
  });
}

// POST — shu hisobot ishlari uchun ALOHIDA sudya tortish (umumiy navbatdan ustun).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id) || 0;
  await requestMibJudgeSync(id > 0 ? id : 0);
  return NextResponse.json({ ok: true });
}
