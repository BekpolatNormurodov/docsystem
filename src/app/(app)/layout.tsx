import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { konveyerSnapshots, konveyerStageBadges } from '@/lib/konveyer';
import { AppShell, ConfirmProvider } from '@/ui';
import type { NavItem } from '@/ui/AppShell';
import { STEP_META, allowedSteps, allowedModules, MODULE_META, canAccess, SUBITEM_KEYS, SUBITEM_META, roleLabel } from '@/lib/access';
import { buxgalteriyaCounts } from '@/lib/buxgalteriya';
import { SnapshotPicker } from './konveyer/SnapshotPicker';
import { LanguageSwitcher } from './LanguageSwitcher';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireUser (NOT requireAdmin): a yurist lives inside this layout too — they just
  // get a smaller nav. Role decides what the sidebar offers.
  const user = await requireUser();
  const isAdmin = user.role === 'ADMIN';
  // Buxgalteriya («Invoice») ruxsati — endi Sud step ostidagi sub-item; faqat ruxsatlilar kiradi.
  const hasBux = canAccess(user, 'buxgalteriya');

  // The pipeline steps this user may open, as stepper items (DRY with access.ts).
  // Sidebar sub-items nested under a step (route-based, NOT in-page tabs).
  const SUB_ITEMS: Record<string, { href: string; label: string }[]> = {
    '/ariza': [
      { href: '/ariza', label: 'Arizani tayyorlash' },
      { href: '/ariza/skaner', label: 'Arizalarni skanerlash' },
    ],
    '/sud': [
      { href: '/sud/invoice', label: 'Invoice yaratish' },
      { href: '/sud/oferta', label: 'Oferta tayyorlash' },
      { href: '/sud', label: 'Sudga yuborish' },
      { href: '/sud/qaytganlar', label: 'Qaytganlar' },
    ],
  };
  // Sub-item href → ruxsat kaliti (masalan /sud/invoice → 'sud:invoice'); qulflashni shu bilan hisoblaymiz.
  const subKeyByHref = new Map(SUBITEM_KEYS.map((k) => [SUBITEM_META[k].href, k]));
  const stepNav: NavItem[] = allowedSteps(user).map((k) => ({
    href: STEP_META[k].href,
    label: STEP_META[k].label,
    icon: STEP_META[k].icon,
    section: 'Boshqaruv',
    step: STEP_META[k].step,
    // Sub-item'lar: ruxsat bo'lmasa `locked` (sidebar'da X, bosib bo'lmaydi).
    children: (() => {
      const base = SUB_ITEMS[STEP_META[k].href]?.map((c) => {
        const sk = subKeyByHref.get(c.href);
        return { ...c, locked: sk ? !canAccess(user, sk) : false };
      }) ?? [];
      // Sud step ostiga «Buxgalteriya-invoice» — faqat buxgalteriya ruxsati bo'lsa ko'rinadi.
      if (k === 'sud' && hasBux) base.push({ href: '/buxgalteriya', label: 'Buxgalteriya-invoice', locked: false });
      return base.length ? base : undefined;
    })(),
  }));

  // Shared pipeline date: rendered once in the sidebar (Boshqaruv), driven by the konv_s cookie —
  // every step-page and Hisobot read the same cookie, so one pick moves the whole pipeline.
  // Guarded: a DB hiccup here must not 500 EVERY app page — the sidebar just renders without the picker.
  const snaps = await konveyerSnapshots().catch(() => [] as Awaited<ReturnType<typeof konveyerSnapshots>>);
  const cookieS = cookies().get('konv_s')?.value;
  const parsed = cookieS ? Number(cookieS) : NaN;
  const selectedSnap = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : (snaps[0]?.id ?? 0);

  // Per-stage case counts → stepper badges (scoped to the selected snapshot). Guarded like the picker.
  const b = await konveyerStageBadges(selectedSnap).catch(() => ({ phase: {} as Record<string, number>, talabnoma: 0, total: 0 }));
  const badgeByHref: Record<string, string> = {
    '/talabnoma': b.total > 0 ? `${b.talabnoma}/${b.total}` : '',
    '/ariza': String(b.phase.SIGN ?? 0),
    '/sud': String((b.phase.BOJ ?? 0) + (b.phase.COURT ?? 0)),
    '/mib': String(b.phase.EXEC ?? 0),
  };
  const withBadges = (items: NavItem[]) => items.map((i) => (badgeByHref[i.href] ? { ...i, badgeText: badgeByHref[i.href] } : i));

  // «Alohida» modullar — endi ruxsatga bog'liq: ADMIN hammasini, YURIST faqat berilganini ko'radi
  // (foydalanuvchi so'rovi). Sidebar eng pastida (bottom: true).
  // Buxgalteriya — «Alohida»da ham, «Menyu»da ham EMAS: u Sud step ostidagi sub-item (yuqorida qo'shildi).
  const moduleNav: NavItem[] = allowedModules(user)
    .filter((k) => k !== 'buxgalteriya')
    .map((k) => ({ href: MODULE_META[k].href, label: MODULE_META[k].label, icon: MODULE_META[k].icon, bottom: true }));

  // Faqat buxgalteriya ruxsatiga ega YURIST (Ulugbek) — boshqa hech nima yo'q. Uning uchun Sud step
  // ochilmaydi, shuning uchun «Buxgalteriya-invoice»ni alohida band qilib beramiz (sanoq badge bilan).
  const onlyBux = user.role === 'YURIST' && user.steps.length > 0 && user.steps.every((k) => k === 'buxgalteriya');
  let buxSoloNav: NavItem | null = null;
  if (onlyBux) {
    const bx = await buxgalteriyaCounts(selectedSnap).catch(() => ({ total: 0, paid: 0 }));
    buxSoloNav = {
      href: '/buxgalteriya',
      label: 'Buxgalteriya-invoice',
      icon: 'sheet',
      section: 'Boshqaruv',
      badgeText: bx.total > 0 ? `${bx.paid}/${bx.total}` : '',
    };
  }

  // Hujjatlar — HAMMAGA ko'rinadi (portfel/sana ko'rish), lekin yuklash/o'zgartirish faqat adminda
  // (sahifa ichida guard). Step'lar eng tepasida (step: 0).
  const hujjatlarNav: NavItem = { href: '/hujjatlar', label: 'Hujjatlar', icon: 'files', section: 'Boshqaruv', step: 0 };

  // Admin: full app + user/audit management. Yurist: only their granted steps, nothing else.
  const nav: NavItem[] = onlyBux
    ? // Faqat buxgalter (Ulugbek): yolg'iz «Buxgalteriya-invoice».
      (buxSoloNav ? [buxSoloNav] : [])
    : isAdmin
    ? [
        // Hisobot (dashboard) — sidebardan olib turildi (foydalanuvchi so'rovi). Sahifa /konveyer'da
        // qoladi, faqat menyuda ko'rinmaydi. Qaytarish: quyidagi qatorni oching.
        // { href: '/konveyer', label: 'Hisobot', icon: 'dashboard', section: 'Boshqaruv' },
        hujjatlarNav,
        ...withBadges(stepNav),
        { href: '/mijozlar', label: 'Mijozlar', icon: 'users', section: 'Menyu' },
        { href: '/firms', label: 'Firmalar', icon: 'building', section: 'Menyu' },
        { href: '/foydalanuvchilar', label: 'Foydalanuvchilar', icon: 'user', section: 'Menyu' },
        { href: '/jurnal', label: 'Amaliyotlar', icon: 'calendar', section: 'Menyu' },
        // «Alohida» modullar (bottom) — buxgalteriyasiz (u Sud ostida).
        ...moduleNav,
      ]
    : [
        // Yurist: Hujjatlar (ko'rish) + granted steps (Buxgalteriya Sud ostida) + Mijozlar + modules.
        hujjatlarNav,
        ...withBadges(stepNav),
        { href: '/mijozlar', label: 'Mijozlar', icon: 'users', section: 'Menyu' },
        ...moduleNav,
      ];

  // Date picker + connections/settings now live in the header top-right (frees the sidebar so it
  // fits without a scrollbar). topActions are admin-only; the picker shows whenever there are steps.
  // Sana/snapshot filtri — endi HAR bir foydalanuvchiga (snapshot bo'lsa), faqat bosqichlilarga emas
  // (foydalanuvchi so'rovi: narigi userlar ham umumiy sana bo'yicha filterни tanlay olsin).
  const showPicker = snaps.length > 0;
  const topActions: NavItem[] = isAdmin
    ? [
        { href: '/ulanishlar', label: 'Ulanishlar', icon: 'link' },
        { href: '/settings', label: 'Sozlamalar', icon: 'settings' },
      ]
    : [{ href: '/jurnal', label: 'Mening amaliyotlarim', icon: 'calendar' }];
  const lang = cookies().get('lang')?.value ?? 'uz';

  return (
    <ConfirmProvider>
      <AppShell
        appName="Yurist Tizimi"
        nav={nav}
        user={{ fullName: user.fullName, roleLabel: onlyBux ? 'Buxgalter' : roleLabel(user.role) }}
        topActions={topActions}
        headerExtra={
          <div className="flex items-center gap-1.5">
            {showPicker && <div className="w-[132px]"><SnapshotPicker options={snaps} value={selectedSnap} /></div>}
            <LanguageSwitcher lang={lang} />
          </div>
        }
      >
        {children}
      </AppShell>
    </ConfirmProvider>
  );
}
