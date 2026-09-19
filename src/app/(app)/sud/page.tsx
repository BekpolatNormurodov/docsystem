import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { canAccess, landingHref } from '@/lib/access';
import { loadStageData } from '../konveyer/stage-data';
import { SudTabs, type SudTabKey } from '../konveyer/SudTabs';
import { courtReadiness } from '@/lib/court-ready';

export const dynamic = 'force-dynamic';

// /sud — 3 tab: Qaytganlar · Qoralama (1 qadam) · Sudga o'tkazish (2026-09-19). Deep link:
// /sud?tab=qaytgan|qoralama|sud&firm=<id>&s=<snapshot>.
//
// RUXSAT — tab bo'yicha: sud:send (2- va 3-tab) va sud:returns (1-tab, eski /sud/qaytganlar).
// `requireAccess('sud:send')` ATAYIN ishlatilmaydi: faqat «Qaytganlar» berilgan yurist uchun
// landingHref = /sud/qaytganlar → bu yerga redirect → sud:send yo'q → yana landingHref …
// cheksiz redirect bo'lardi. Shuning uchun redirect'siz tekshiruv (canAccess): ikkalasi ham yo'q
// bo'lsa — landing'ga; bittasi bo'lsa sahifa ochiladi, ruxsatsiz tab «ruxsat yo'q» deydi.
export default async function SudPage({ searchParams }: { searchParams: { s?: string; tab?: string; firm?: string } }) {
  const user = await requireUser();
  const canSend = canAccess(user, 'sud:send');
  const canReturns = canAccess(user, 'sud:returns');
  if (!canSend && !canReturns) redirect(landingHref(user) ?? '/login');

  const d = await loadStageData('COURT', searchParams.s);

  const raw = searchParams.tab;
  const initialTab: SudTabKey = raw === 'qaytgan' || raw === 'qoralama' || raw === 'sud' ? raw : canSend ? 'qoralama' : 'qaytgan';
  const firmNum = Number(searchParams.firm);
  const initialFirmId = Number.isInteger(firmNum) && d.firms.some((f) => f.firmId === firmNum) ? firmNum : null;

  // 2-tab uchun court-ready'ni server-render qilamiz (CourtManager mount-fetch'siz, darhol sonlar
  // bilan chiziladi; tepadagi 5 bosqich ham shundan). Firma ?firm= bo'lsa — o'sha firma bo'yicha,
  // CourtManager'ning boshlang'ich filtri bilan mos. Avvalgi courtStatusBoard/courtReturns
  // so'rovlari olib tashlandi — ular /sud'da hech qachon ko'rsatilmasdi (o'lik «stat»/«returns»).
  const initialData = canSend
    ? { snapshotId: d.selectedId, readiness: await courtReadiness(d.selectedId, initialFirmId ?? undefined) }
    : null;

  return (
    <SudTabs
      firms={d.firms}
      selectedId={d.selectedId}
      initialData={initialData}
      initialTab={initialTab}
      initialFirmId={initialFirmId}
      canSend={canSend}
      canReturns={canReturns}
    />
  );
}
