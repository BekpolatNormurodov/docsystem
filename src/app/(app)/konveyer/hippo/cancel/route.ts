import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { deleteRegistry, registryExists } from '@/lib/hippo/xat';
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
    let deleted = false;
    let lastErr: string | null = null;
    try {
      const res = await deleteRegistry(session, registryId);
      // Log the raw hippo reply so a silent-refusal (200 + failure envelope) is diagnosable from the log.
      console.log('[hippo cancel] registry=%s ok=%s status=%s json=%s', registryId, res.ok, res.status,
        (() => { try { return JSON.stringify(res.json)?.slice(0, 500); } catch { return String(res.json); } })());
      if (res.ok) deleted = true;
      else {
        const j: any = res.json;
        const msg = typeof j === 'string' ? j : j?.message ?? j?.error ?? null;
        lastErr = `xat.hippo rad etdi (${res.status})${msg ? `: ${String(msg).slice(0, 160)}` : ''}`;
      }
    } catch (e) {
      // Timeout/abort: hippo frequently deletes server-side but STALLS the reply — don't give up, confirm below.
      lastErr = e instanceof Error && /abort/i.test(e.message) ? 'xat.hippo javob bermadi (timeout)' : 'Bekor qilib boʻlmadi';
      console.warn('[hippo cancel] delete threw, will confirm by re-list:', lastErr);
    }

    // Confirm even after a "failure": if the reyestr is gone from the live list, the delete DID land.
    if (!deleted) {
      try { if (!(await registryExists(session, registryId))) { deleted = true; console.log('[hippo cancel] registry=%s confirmed gone via re-list', registryId); } }
      catch (e) { console.error('[hippo cancel] confirm re-list failed', e); }
    }

    if (!deleted) return NextResponse.json({ error: lastErr ?? 'Bekor qilib boʻlmadi' }, { status: 502 });

    // Un-trace the cancelled registry so its clients become «remaining» again (re-sendable). Non-fatal.
    let untraced = 0;
    try { untraced = await clearSentByRegistry(String(registryId)); } catch (e) { console.error('clearSentByRegistry failed', e); }
    return NextResponse.json({ ok: true, untraced });
  } catch (e) {
    console.error('hippo cancel failed', e);
    return NextResponse.json({ error: 'Bekor qilib boʻlmadi' }, { status: 502 });
  }
}
