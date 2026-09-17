// Next.js server-boot hook. AUTO-RESUME MIB: har deploy/restart web jarayonini qayta ishga tushiradi va
// INLINE ishlaydigan MIB avtomatorini o'ldiradi — ilgari operator qo'lда «GO» bosmasa run to'xtab
// qolardi (kechasi soatlab bekor turishi mumkin edi). Endi boot'да autoRun=1 bo'lgan (lekin jonli loop'i
// yo'q) hisobotlar avtomat davom etadi. runMibReportJob tugagach autoRun o'zi 0 bo'ladi — shuning uchun
// tugagan hisobot qayta ishga tushmaydi.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // faqat Node server; edge/build'да emas
  try {
    const { prisma } = await import('@/lib/db');
    const { startMibRun } = await import('@/lib/mib/run');
    const reports = await prisma.mibReport.findMany({ where: { autoRun: true }, select: { id: true } });
    if (!reports.length) return;
    for (const r of reports) {
      // startMibRun: ACTIVE bo'lsa yoki PENDING yo'q bo'lsa null qaytaradi (xavfsiz, dublikat bo'lmaydi).
      const res = await startMibRun(r.id).catch((e) => { console.error(`[mib] auto-resume report ${r.id} xato:`, e); return null; });
      if (res) console.log(`[mib] auto-resume: report ${r.id} → ${res.pending} PENDING davom ettirildi (job ${res.jobId})`);
    }
  } catch (e) {
    console.error('[mib] auto-resume boot xatosi:', e);
  }
}
