import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { getBalance, listRegistries } from '@/lib/hippo/xat';
import { summarizeRegistryMails } from '@/lib/hippo/mail-status';

export const runtime = 'nodejs';
export const maxDuration = 120;

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');
const asArray = (json: any): any[] => (Array.isArray(json) ? json : json?.data?.items ?? json?.items ?? json?.data ?? []);
const regCount = (r: any): number => Number(r?.mailCount ?? r?.count ?? r?.total ?? (/\((\d+)\s*ta\)/.exec(String(r?.name ?? ''))?.[1]) ?? 0);

// GET (no firmId) — OVERALL: aggregate balance + total sent across every firm
// with a live hippo session (so the panel is never empty without a firm picked).
async function overall() {
  const [firms, sessions] = await Promise.all([
    prisma.firm.findMany({ select: { id: true, shortName: true, stir: true } }),
    prisma.externalSession.findMany({ where: { provider: 'HIPPO', status: 'ACTIVE' }, select: { account: true } }),
  ]);
  const acctSet = new Set(sessions.map((s) => digits(s.account)));
  const connected = firms.filter((f) => acctSet.has(digits(f.stir)));

  const perFirm = await Promise.all(connected.map(async (f) => {
    const acct = digits(f.stir);
    try {
      const session = await getStoredHippoSession(acct);
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
  return NextResponse.json({
    overall: true,
    checkedAt: new Date().toISOString(),
    totals: { firmCount: ok.length, balance: ok.reduce((s, x) => s + x.balance, 0), sent: ok.reduce((s, x) => s + x.sent, 0), registries: ok.reduce((s, x) => s + x.registries, 0) },
    firms: perFirm,
  });
}

// GET ?firmId= — READ-ONLY live hippo status for a firm: wallet balance + the
// firm's recent talabnoma registries with delivery tallies (yetkazilgan/kutilmoqda).
// Nothing is sent; purely reads what already exists on xat.hippo.
export async function GET(req: NextRequest) {
  await requireAdmin();
  const firmId = Number(req.nextUrl.searchParams.get('firmId'));
  if (!firmId) return overall();

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { shortName: true, stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  const acct = digits(firm.stir);
  let session;
  try {
    session = await getStoredHippoSession(acct);
  } catch {
    return NextResponse.json({ connected: false, firmName: firm.shortName });
  }

  try {
    const bal = await getBalance(session);
    const b = (bal.json?.data ?? bal.json ?? {}) as any;
    const balance = Number(b.balance ?? 0);
    const tariff = b.effectiveTariff ?? null;
    const free = !tariff || Number(tariff.basePrice ?? 0) === 0;

    const reg = await listRegistries(session, { PageIndex: 1, PageSize: 8 });
    const regs = asArray(reg.json);
    const registries = await Promise.all(
      regs.slice(0, 6).map(async (r) => {
        let sum;
        try { sum = await summarizeRegistryMails(session!, r.id); } catch { sum = null; }
        return {
          id: r.id,
          name: r.name ?? `Reyestr ${r.id}`,
          createdAt: r.createdAt ?? r.createdDate ?? null,
          total: sum?.total ?? (r.mailCount ?? 0),
          delivered: sum?.delivered ?? 0,
          failed: sum?.failed ?? 0,
          pending: sum?.pendingPerform ?? 0,
          draft: sum?.draft ?? 0,
        };
      }),
    );
    return NextResponse.json({ connected: true, firmName: firm.shortName, balance, free, registries, checkedAt: new Date().toISOString() });
  } catch (e) {
    console.error('hippo status failed', e);
    return NextResponse.json({ connected: false, firmName: firm.shortName, error: 'hippo bilan aloqa yo‘q (token eskirgan bo‘lishi mumkin)' });
  }
}
