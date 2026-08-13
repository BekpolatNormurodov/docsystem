import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { deleteRegistry } from '@/lib/hippo/xat';
import { clearSentByRegistry } from '@/lib/hippo/talabnoma-trace';

export const runtime = 'nodejs';

const digits = (s?: string | null) => (s ?? '').replace(/\D+/g, '');

// POST { firmId, registryId } — «Bekor qilish»: delete a xat.hippo registry (e.g. a draft you no
// longer want, or a whole batch you sent by mistake). Thin wrapper over hippo's DELETE /Registry/{id}.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const firmId = Number(body?.firmId);
  const registryId = body?.registryId;
  if (!firmId || registryId == null || registryId === '') {
    return NextResponse.json({ error: 'firmId va registryId kerak' }, { status: 400 });
  }

  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { stir: true } });
  if (!firm) return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });

  let session;
  try { session = await getStoredHippoSession(digits(firm.stir)); }
  catch { return NextResponse.json({ error: 'Firma xat.hippo ga ulanmagan' }, { status: 409 }); }

  try {
    const res = await deleteRegistry(session, registryId);
    if (!res.ok) return NextResponse.json({ error: `xat.hippo rad etdi (${res.status})` }, { status: 502 });
    // Un-trace the cancelled registry so its clients become «remaining» again (re-sendable). Non-fatal.
    let untraced = 0;
    try { untraced = await clearSentByRegistry(String(registryId)); } catch (e) { console.error('clearSentByRegistry failed', e); }
    return NextResponse.json({ ok: true, untraced });
  } catch (e) {
    console.error('hippo cancel failed', e);
    return NextResponse.json({ error: 'Bekor qilib boʻlmadi' }, { status: 502 });
  }
}
