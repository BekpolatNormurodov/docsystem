// Sud yo'naltirish + kunlik limit dvigateli. Bir firmaning tayyor case'lari «Sudga yuborish»da
// firmaning sud(lar)i bo'yicha taqsimlanadi: har sudning kunlik limiti + vaqt chegarasi (cutoff) +
// ish kunlari (Asia/Tashkent). Limitdan oshgani BUGUN yuborilmaydi — keyingi ish kuniga suriladi.
// Konfiguratsiya (Court jadvali) bo'sh bo'lsa — hech narsa cheklanmaydi (eski xatti-harakat).
import { prisma } from './db';
import type { Court } from '@prisma/client';

// Uzbekiston vaqti — UTC+5, DST yo'q. Server UTC bo'lsa ham cutoff/kun to'g'ri hisoblanadi.
const TASHKENT_OFFSET_MIN = 5 * 60;

/** Hozirgi Toshkent vaqti: {dow: Yak=0..Shan=6, minutes: yarim tundan daqiqa}. */
export function tashkentClock(now: Date = new Date()): { dow: number; minutes: number } {
  const shifted = new Date(now.getTime() + TASHKENT_OFFSET_MIN * 60_000);
  return { dow: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** Toshkent «bugun»ning boshi va oxiri (UTC Date'lar) — courtSentAt bo'yicha kunlik sanoq uchun. */
export function tashkentDayRangeUtc(now: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + TASHKENT_OFFSET_MIN * 60_000);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), d = shifted.getUTCDate();
  const startUtcMs = Date.UTC(y, m, d) - TASHKENT_OFFSET_MIN * 60_000; // Toshkent yarim tuni → UTC
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60_000) };
}

function weekdaysOf(court: Court): number[] {
  const w = court.weekdays;
  return Array.isArray(w) ? (w as unknown[]).map(Number).filter((n) => Number.isInteger(n)) : [1, 2, 3, 4, 5];
}

export interface CourtWindow {
  open: boolean;               // bugun (ish kuni + cutoffdan oldin) qabul qiladimi
  reason: 'ok' | 'weekend' | 'past-cutoff' | 'inactive';
}

/** Sud bugun ochiqmi (ish kuni + cutoffdan oldin)? Limit sanog'idan alohida — vaqt/kun tekshiruvi. */
export function courtWindow(court: Court, now: Date = new Date()): CourtWindow {
  if (!court.active) return { open: false, reason: 'inactive' };
  const { dow, minutes } = tashkentClock(now);
  if (!weekdaysOf(court).includes(dow)) return { open: false, reason: 'weekend' };
  if (minutes >= court.cutoffMinutes) return { open: false, reason: 'past-cutoff' };
  return { open: true, reason: 'ok' };
}

/** Barcha sudlar (tartib bo'yicha). */
export function listCourts() {
  return prisma.court.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

/** Default (isDefault) sud — ruxsati aniqlanmagan firmalar shunga ketadi. */
export async function defaultCourt(): Promise<Court | null> {
  return (await prisma.court.findFirst({ where: { isDefault: true, active: true }, orderBy: { id: 'asc' } }))
    ?? (await prisma.court.findFirst({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }));
}

/** Firmaning sud(lar)i tartib bilan (birinchi = asosiy). Ruxsat yozuvi bo'lmasa — default sud. */
export async function firmCourtsOrdered(firmId: number): Promise<Court[]> {
  const access = await prisma.courtFirmAccess.findMany({
    where: { firmId, court: { active: true } },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: { court: true },
  });
  if (access.length) return access.map((a) => a.court);
  const def = await defaultCourt();
  return def ? [def] : [];
}

/** Firmaning ASOSIY sudi (ariza murojaati + invoice payload shundan). Konfiguratsiya bo'lmasa null. */
export async function firmPrimaryCourt(firmId: number): Promise<Court | null> {
  return (await firmCourtsOrdered(firmId))[0] ?? null;
}

/** Har sud uchun bugun yuborilgan (courtSentAt) case soni. */
export async function usedTodayByCourt(now: Date = new Date()): Promise<Map<number, number>> {
  const { start, end } = tashkentDayRangeUtc(now);
  const grouped = await prisma.arizaCase.groupBy({
    by: ['courtId'],
    where: { courtSentAt: { gte: start, lt: end }, courtId: { not: null } },
    _count: { _all: true },
  });
  const m = new Map<number, number>();
  for (const g of grouped) if (g.courtId != null) m.set(g.courtId, g._count._all);
  return m;
}

export interface CourtBudget { court: Court; window: CourtWindow; used: number; remaining: number }

/** Firmaning sudlari bo'yicha bugungi byudjet (limit − yuborilgan), tartib bilan. */
export async function firmCourtBudgets(firmId: number, now: Date = new Date()): Promise<CourtBudget[]> {
  const [courts, used] = await Promise.all([firmCourtsOrdered(firmId), usedTodayByCourt(now)]);
  return courts.map((court) => {
    const win = courtWindow(court, now);
    const u = used.get(court.id) ?? 0;
    const remaining = win.open ? Math.max(0, court.dailyQuota - u) : 0;
    return { court, window: win, used: u, remaining };
  });
}

export interface Allocation { assignments: { caseId: number; courtId: number }[]; deferred: number[] }

/**
 * Case'larni firmaning sudlariga taqsimlaydi: birinchi sudni limitigacha to'ldiradi, so'ng keyingisi.
 * Sig'magani `deferred` — bugun yuborilmaydi (keyingi ish kuniga suriladi). Firmada konfiguratsiya
 * bo'lmasa (sud yo'q) — HAMMASI assignments'siz `deferred:[]` bo'lmaydi: cheklovsiz o'tishi uchun
 * `courts.length===0` → hammasi ruxsat (courtId=null bilan), chaqiruvchi buni «cheksiz» deb qaraydi.
 */
export async function allocateFirmCases(firmId: number, caseIds: number[], now: Date = new Date()): Promise<Allocation | null> {
  const budgets = await firmCourtBudgets(firmId, now);
  if (budgets.length === 0) return null; // konfiguratsiya yo'q — cheklovsiz (eski xatti-harakat)
  const budgetByCourt = new Map(budgets.map((b) => [b.court.id, b]));
  const primaryId = budgets[0].court.id;

  // Ariza bosqichida biriktirilgan sudni HURMAT qilamiz: case'ning courtId'si bo'lsa — o'shani ishlatamiz,
  // yo'q bo'lsa firma asosiy sudi. So'ng har sudning bugungi limiti/oynasi bo'yicha kesamiz (oshgani deferred).
  const rows = await prisma.arizaCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, courtId: true } });
  const wantByCourt = new Map<number, number[]>();
  for (const r of rows) {
    const cid = r.courtId && budgetByCourt.has(r.courtId) ? r.courtId : primaryId;
    if (!wantByCourt.has(cid)) wantByCourt.set(cid, []);
    wantByCourt.get(cid)!.push(r.id);
  }
  const assignments: { caseId: number; courtId: number }[] = [];
  const deferred: number[] = [];
  for (const [cid, ids] of wantByCourt) {
    const rem = budgetByCourt.get(cid)?.remaining ?? 0;
    assignments.push(...ids.slice(0, rem).map((caseId) => ({ caseId, courtId: cid })));
    deferred.push(...ids.slice(rem));
  }
  return { assignments, deferred };
}

/** Taqsimlangan case'larni «yuborilgan» deb belgilaydi: courtId + courtSentAt=now (limit sanog'i). */
export async function consumeCourtSend(assignments: { caseId: number; courtId: number }[], now: Date = new Date()): Promise<void> {
  if (!assignments.length) return;
  await prisma.$transaction(
    assignments.map((a) => prisma.arizaCase.update({ where: { id: a.caseId }, data: { courtId: a.courtId, courtSentAt: now } })),
  );
}

/** «Bekor qilish»da limitni qaytarish — courtSentAt tozalanadi (courtId qoladi, tarix uchun). */
export async function releaseCourtSend(caseIds: number[]): Promise<void> {
  if (!caseIds.length) return;
  await prisma.arizaCase.updateMany({ where: { id: { in: caseIds } }, data: { courtSentAt: null } });
}

// ── Admin (Sozlamalar) ──────────────────────────────────────────────────────────────────────
const DEFAULT_COURT_NAME = 'Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga';

/** Birinchi ochilishda default Uchtepa sudini yaratadi (jadval bo'sh bo'lsa) + bir marta Bright'ning
 *  2-sudini (kechki yo'lak) seed qiladi va Bright'ni ikkala sudga biriktiradi. Non-breaking. */
export async function ensureSeedCourt(): Promise<void> {
  const n = await prisma.court.count();
  if (n === 0) {
    await prisma.court.create({
      data: {
        billingCourtId: '525', courtType: 'CITIZEN',
        nameUz: DEFAULT_COURT_NAME, shortName: 'Uchtepa tumanlararo sudi',
        dailyQuota: 200, cutoffMinutes: 840, weekdays: [1, 2, 3, 4, 5],
        active: true, isDefault: true, sortOrder: 0,
      },
    });
  }

  // Bir martalik: Bright uchun 2-sud (500/18:00) + ikkala sudga ruxsat. `court_seed_bright` bayrog'i
  // bilan qo'riqlanadi — qayta ishlamaydi, admin qo'lda o'zgartirsa ustidan yozmaydi.
  const flag = await prisma.setting.findUnique({ where: { key: 'court_seed_bright' } });
  if (flag) return;
  const bright = await prisma.firm.findFirst({ where: { OR: [{ code: '12842' }, { shortName: { contains: 'BRIGHT' } }] }, select: { id: true } });
  const defCourt = await defaultCourt();
  if (bright && defCourt) {
    const already = await prisma.courtFirmAccess.count({ where: { firmId: bright.id } });
    if (already === 0) {
      let second = await prisma.court.findFirst({ where: { shortName: { contains: 'Yuqorichirchiq' } } });
      if (!second) {
        // billingCourtId — VAQTINCHALIK, admin «Sudlar»da haqiqiy billing.sud.uz Sud id bilan almashtiradi.
        second = await prisma.court.create({
          data: {
            billingCourtId: 'SET-ME-YUQORICHIRCHIQ', courtType: 'CITIZEN',
            nameUz: 'Fuqarolik ishlari boʻyicha Yuqorichirchiq tumanlararo sudiga', shortName: 'Yuqorichirchiq tumanlararo sudi',
            dailyQuota: 500, cutoffMinutes: 1080, weekdays: [1, 2, 3, 4, 5], active: true, isDefault: false, sortOrder: 1,
          },
        });
      }
      await prisma.courtFirmAccess.createMany({ data: [
        { courtId: defCourt.id, firmId: bright.id, order: 0 },
        { courtId: second.id, firmId: bright.id, order: 1 },
      ] });
    }
  }
  await prisma.setting.upsert({ where: { key: 'court_seed_bright' }, create: { key: 'court_seed_bright', value: '1' }, update: {} });
}

export interface CourtAdminRow {
  id: number; billingCourtId: string; courtType: string; nameUz: string; shortName: string;
  dailyQuota: number; cutoffMinutes: number; weekdays: number[]; active: boolean; isDefault: boolean; sortOrder: number;
  firmIds: number[];
  billingReady: boolean;      // billingCourtId is a real numeric Sud id (else invoices fall back to default)
  usedToday: number;          // bugun shu sudga yuborilgan (courtSentAt) case soni
  windowReason: CourtWindow['reason']; // ochiq / weekend / past-cutoff / inactive
  caseCount: number;          // shu sudga bog'langan case'lar (o'chirish bloki + info)
}

/** Admin ro'yxati: sudlar (+ ruxsat berilgan firmalar) va barcha firmalar. Jonli: bugungi
 *  yuborilgan (usedToday), oyna holati (windowReason) va bog'langan case soni ham qaytadi. */
export async function courtsForAdmin(now: Date = new Date()): Promise<{ courts: CourtAdminRow[]; firms: { id: number; code: string; shortName: string }[] }> {
  const [courts, firms, usedToday, caseCounts] = await Promise.all([
    prisma.court.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { access: { orderBy: { order: 'asc' } } } }),
    prisma.firm.findMany({ select: { id: true, code: true, shortName: true }, orderBy: { shortName: 'asc' } }),
    usedTodayByCourt(now),
    prisma.arizaCase.groupBy({ by: ['courtId'], where: { courtId: { not: null } }, _count: { _all: true } }),
  ]);
  const caseBy = new Map<number, number>();
  for (const g of caseCounts) if (g.courtId != null) caseBy.set(g.courtId, g._count._all);
  return {
    courts: courts.map((c) => ({
      id: c.id, billingCourtId: c.billingCourtId, courtType: c.courtType, nameUz: c.nameUz, shortName: c.shortName,
      dailyQuota: c.dailyQuota, cutoffMinutes: c.cutoffMinutes,
      weekdays: weekdaysOf(c), active: c.active, isDefault: c.isDefault, sortOrder: c.sortOrder,
      firmIds: c.access.map((a) => a.firmId),
      billingReady: /^\d+$/.test(c.billingCourtId),
      usedToday: usedToday.get(c.id) ?? 0,
      windowReason: courtWindow(c, now).reason,
      caseCount: caseBy.get(c.id) ?? 0,
    })),
    firms,
  };
}

export interface SaveCourtInput {
  id?: number; billingCourtId: string; courtType?: string; nameUz: string; shortName: string;
  dailyQuota: number; cutoffMinutes: number; weekdays: number[]; active: boolean; isDefault: boolean; sortOrder?: number;
  firmIds: number[];
}

/** Sud yaratish/tahrirlash + firma ruxsatlari. Bitta default bo'lishini ta'minlaydi. */
export async function saveCourt(input: SaveCourtInput): Promise<number> {
  const data = {
    billingCourtId: input.billingCourtId.trim(),
    courtType: (input.courtType || 'CITIZEN').trim(),
    nameUz: input.nameUz.trim(),
    shortName: input.shortName.trim(),
    dailyQuota: Math.max(0, Math.floor(input.dailyQuota) || 0),
    cutoffMinutes: Math.min(1440, Math.max(0, Math.floor(input.cutoffMinutes) || 0)),
    weekdays: [...new Set(input.weekdays.map(Number).filter((n) => n >= 0 && n <= 6))].sort() as number[],
    active: !!input.active,
    isDefault: !!input.isDefault,
    sortOrder: Math.floor(input.sortOrder ?? 0) || 0,
  };
  const court = input.id
    ? await prisma.court.update({ where: { id: input.id }, data })
    : await prisma.court.create({ data });
  // Bitta default — boshqalarini o'chiramiz.
  if (data.isDefault) await prisma.court.updateMany({ where: { id: { not: court.id } }, data: { isDefault: false } });
  // Firma ruxsatlari — to'liq qayta yozamiz (tartib = index).
  await prisma.courtFirmAccess.deleteMany({ where: { courtId: court.id } });
  const uniq = [...new Set(input.firmIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (uniq.length) {
    await prisma.courtFirmAccess.createMany({ data: uniq.map((firmId, i) => ({ courtId: court.id, firmId, order: i })) });
  }
  return court.id;
}

/** Firma-markazli biriktirish: bitta firma qaysi sud(lar)ga chiqishini to'liq qayta yozadi (tartib = index). */
export async function setFirmCourtsAccess(firmId: number, courtIds: number[]): Promise<void> {
  const uniq = [...new Set(courtIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  await prisma.courtFirmAccess.deleteMany({ where: { firmId } });
  if (uniq.length) {
    await prisma.courtFirmAccess.createMany({ data: uniq.map((courtId, i) => ({ courtId, firmId, order: i })) });
  }
}

/** Sud o'chirish — case'lar bog'langan bo'lsa faqat o'chirmaymiz (active=false qiling). */
export async function deleteCourt(id: number): Promise<{ ok: boolean; reason?: string }> {
  const used = await prisma.arizaCase.count({ where: { courtId: id } });
  if (used > 0) return { ok: false, reason: `Bu sudga ${used} ta case bog'langan — o'chirib bo'lmaydi. «Active»ni o'chiring.` };
  await prisma.court.delete({ where: { id } });
  return { ok: true };
}
