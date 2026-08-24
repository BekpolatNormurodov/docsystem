import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSyncStates, isSyncRunning, syncFirm, AUTO_EVERY_MS } from '@/lib/billing-check/sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

// GET — barcha firmalarning yig'ish holati. UI shuni har necha soniyada so'rab, progressni
// ko'rsatadi va yig'ish ketayotganda tugmalarni bloklaydi.
export async function GET(_req: NextRequest) {
  await requireAdmin();
  const states = await getSyncStates();
  return NextResponse.json({ states, autoEveryMs: AUTO_EVERY_MS, running: states.some((s) => s.status === 'RUNNING') });
}

// POST { firm } — qo'lda yig'ishni boshlaydi. Javob DARHOL qaytadi, jarayon fonda davom etadi
// (foydalanuvchi sahifadan chiqib ketsa ham to'xtamaydi). Boshqa yig'ish ketayotgan bo'lsa — 409.
export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const firmCode = String(body?.firm ?? '').trim();
  // limit — «oxirgi N ta»; berilmasa butun ro'yxat.
  const rawLimit = Number(body?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 20_000) : undefined;
  if (!firmCode) return NextResponse.json({ error: 'Firma kerak' }, { status: 400 });

  if (await isSyncRunning()) {
    return NextResponse.json({ error: 'Yangilanish ketyapti — tugashini kuting' }, { status: 409 });
  }

  // Fon jarayon: qulfni syncFirm ichida egallaydi, shuning uchun bu yerda kutmaymiz.
  void syncFirm(firmCode, 'MANUAL', limit)
    .then(async (res) => {
      if (!res) return; // qulfni egallay olmadi
      await prisma.billingCheckQuery.create({
        data: {
          createdBy: user.username, mode: 'LIST', query: firmCode, page: null,
          resultCount: res.done, status: 'OK',
          message: `qo‘lda yangilandi: ${res.done} ta${limit ? ` (oxirgi ${limit})` : ''}`,
        },
      }).catch(() => {});
    })
    .catch((e) => console.error('[billing-check] manual sync failed', e));

  return NextResponse.json({ started: true });
}
