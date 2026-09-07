import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { courtsForAdmin, ensureSeedCourt, saveCourt, setFirmCourtsAccess } from '@/lib/court-routing';

export const runtime = 'nodejs';

// GET → sudlar jadvali (+ firma ruxsatlari) va barcha firmalar. Birinchi ochilishda default sudni seed qiladi.
export async function GET() {
  await requireAdmin();
  await ensureSeedCourt().catch(() => {});
  return NextResponse.json(await courtsForAdmin());
}

// POST { action:'save'|'delete', ... } — sud yaratish/tahrirlash/o'chirish.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  try {
    // Sudni O'CHIRISH — ATAYIN yopilgan (admin uchun ham). Sudga minglab ish va ularning
    // ADOLAT'dagi da'volari bog'langan; yozuv yo'qolsa yo'naltirish, kunlik limit sanog'i va
    // «Qaytganlar» tarixi buziladi. Sud ishlatilmasa — «Active» bayrog'ini o'chirish yetarli:
    // u yo'naltirishdan chiqadi, lekin tarix saqlanadi.
    if (action === 'delete') {
      return NextResponse.json(
        { error: 'Sudni o‘chirib bo‘lmaydi — unga bog‘langan ishlar va tarix yo‘qoladi. Ishlatmaslik uchun «Active» bayrog‘ini o‘chiring.' },
        { status: 405 },
      );
    }
    if (action === 'firmCourts') {
      const firmId = Number(body?.firmId);
      if (!firmId) return NextResponse.json({ error: 'firmId kerak' }, { status: 400 });
      await setFirmCourtsAccess(firmId, Array.isArray(body?.courtIds) ? body.courtIds.map(Number) : []);
      return NextResponse.json(await courtsForAdmin());
    }
    // save
    if (!body?.billingCourtId || !body?.nameUz || !body?.shortName) {
      return NextResponse.json({ error: 'Sud id, nomi va qisqa nomi majburiy' }, { status: 400 });
    }
    await saveCourt({
      id: body.id ? Number(body.id) : undefined,
      billingCourtId: String(body.billingCourtId),
      courtType: body.courtType ? String(body.courtType) : 'CITIZEN',
      nameUz: String(body.nameUz),
      shortName: String(body.shortName),
      dailyQuota: Number(body.dailyQuota),
      // Sudga yuborishda ikki ish orasidagi interval. Pastki chegara 5s — 0 yozib qo'yilsa
      // portalga cheklovsiz urilib ketmasin (2026-09-06 blokidan saboq).
      sendIntervalSec: Math.max(5, Number(body.sendIntervalSec) || 60),
      cutoffMinutes: Number(body.cutoffMinutes),
      weekdays: Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [1, 2, 3, 4, 5],
      active: body.active !== false,
      isDefault: body.isDefault === true,
      sortOrder: Number(body.sortOrder ?? 0),
      firmIds: Array.isArray(body.firmIds) ? body.firmIds.map(Number) : [],
    });
    return NextResponse.json(await courtsForAdmin());
  } catch (e) {
    // billingCourtId @unique buzilsa — tushunarli xato.
    const msg = (e as { code?: string })?.code === 'P2002' ? 'Bu «Sud id» allaqachon mavjud' : 'Saqlashda xatolik';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
