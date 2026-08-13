import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { getBalance, listRegistries } from '@/lib/hippo/xat';
import { summarizeRegistryMails } from '@/lib/hippo/mail-status';

export const runtime = 'nodejs';
export const maxDuration = 120;

// xat.hippo registry create-date, tolerant of the field name variants the API uses.
const regDate = (r: any) => r?.createdAt ?? r?.createdDate ?? r?.created ?? r?.createdOn ?? null;
const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const asArray = (json: any): any[] => (Array.isArray(json) ? json : json?.data?.items ?? json?.items ?? json?.data ?? []);
const regCount = (r: any): number => Number(r?.mailCount ?? r?.count ?? r?.total ?? (/\((\d+)\s*ta\)/.exec(String(r?.name ?? ''))?.[1]) ?? 0);

// The panel is served in TWO steps: the cached snapshot from the DB (Setting) is returned instantly,
// then the client asks for ?refresh=1 which pulls LIVE from xat.hippo (slow) and re-writes the cache.
const cacheKey = (firmId: number | null) => `hippo.status.v1.${firmId ?? 'all'}`;

// OVERALL (no firmId): aggregate balance + total sent across every connected firm.
async function computeOverall() {
  const [firms, sessions] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, shortName: true, stir: true } }),
    prisma.externalSession.findMany({ where: { provider: 'HIPPO', status: 'ACTIVE' }, select: { account: true } }),
  ]);
  const acctSet = new Set(sessions.map((s) => digits(s.account)));
  const connected = firms.filter((f) => acctSet.has(digits(f.stir)));

  const perFirm = await Promise.all(connected.map(async (f) => {
    try {
      const session = await getStoredHippoSession(digits(f.stir));
      const bal = await getBalance(session);
      const b = (bal.json?.data ?? bal.json ?? {}) as any;
      const reg = await listRegistries(session, { PageIndex: 1, PageSize: 50 });
      const regs = asArray(reg.json);
      return { firmId: f.id, firmName: f.shortName, connected: true, balance: Number(b.balance ?? 0), registries: regs.length, sent: regs.reduce((s, r) => s + regCount(r), 0) };
    } catch {
      return { firmId: f.id, firmName: f.shortName, connected: false, balance: 0, registries: 0, sent: 0 };
    }
  }));
  const ok = perFirm.filter((x) => x.connected);
  return {
    overall: true,
    checkedAt: new Date().toISOString(),
    totals: { firmCount: ok.length, balance: ok.reduce((s, x) => s + x.balance, 0), sent: ok.reduce((s, x) => s + x.sent, 0), registries: ok.reduce((s, x) => s + x.registries, 0) },
    firms: perFirm,
  };
}

// ONE firm: wallet balance + the most recent reyestrs with delivery tallies. Read-only.
async function computeFirmStatus(firmId: number) {
  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return { notFound: true as const };

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return { connected: false, firmName: firm.shortName }; }

  try {
    const bal = await getBalance(session);
    const b = (bal.json?.data ?? bal.json ?? {}) as any;
    const balance = Number(b.balance ?? 0);
    const tariff = b.effectiveTariff ?? null;
    const free = !tariff || Number(tariff.basePrice ?? 0) === 0;

    // Newest reyestrs first (old ones included but compact) — a just-created reyestr must be visible.
    const reg = await listRegistries(session, { PageIndex: 1, PageSize: 100 });
    const regRaw = asArray(reg.json);
    const regTime = (r: any) => { const d = regDate(r); const t = d ? Date.parse(String(d)) : NaN; return Number.isFinite(t) ? t : (Number(r?.id) || 0); };
    const recent = [...regRaw].sort((a, b) => regTime(b) - regTime(a)).slice(0, 6);
    const registries = await Promise.all(
      recent.map(async (r) => {
        let sum;
        try { sum = await summarizeRegistryMails(session!, r.id); } catch { sum = null; }
        return {
          id: r.id,
          name: r.name ?? `Reyestr ${r.id}`,
          createdAt: regDate(r),
          total: sum?.total ?? (r.mailCount ?? 0),
          delivered: sum?.delivered ?? 0,
          failed: sum?.failed ?? 0,
          pending: sum?.pendingPerform ?? 0,
          draft: sum?.draft ?? 0,
        };
      }),
    );
    return { connected: true, firmName: firm.shortName, balance, free, registries, checkedAt: new Date().toISOString() };
  } catch (e) {
    console.error('hippo status failed', e);
    return { connected: false, firmName: firm.shortName, error: 'hippo bilan aloqa yoʻq (token eskirgan boʻlishi mumkin)' };
  }
}

// GET ?firmId=&refresh= — without refresh: the DB-cached snapshot (instant). With refresh=1: pull
// live from xat.hippo, persist to the cache, and return it.
export async function GET(req: NextRequest) {
  await requireUser();
  const raw = Number(req.nextUrl.searchParams.get('firmId'));
  const firmId = Number.isInteger(raw) && raw > 0 ? raw : null;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const key = cacheKey(firmId);

  if (!refresh) {
    // Instant: the last snapshot we saved — no hippo call, no ~20s wait.
    const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
    if (row?.value) {
      try { return NextResponse.json({ ...JSON.parse(row.value), cached: true }); } catch { /* corrupt cache → fall through */ }
    }
    return NextResponse.json({ cached: true, empty: true });
  }

  // Live pull from xat.hippo → recompute + persist the cache.
  const data = firmId ? await computeFirmStatus(firmId) : await computeOverall();
  if ('notFound' in data && data.notFound) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });
  try {
    const value = JSON.stringify(data);
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch (e) { console.error('hippo status cache write failed', e); }
  return NextResponse.json({ ...data, cached: false });
}
