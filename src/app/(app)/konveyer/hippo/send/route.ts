import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { sendTalabnomaToHippo, type SendMode } from '@/lib/hippo/talabnoma-send';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { snapshotId, firmId, mode?, confirm? } — server-side xat.hippo integration: upload a firm's
// talabnoma reyestr to xat.hippo. Thin wrapper — all logic is `sendTalabnomaToHippo` (also callable
// in-process by the bot).
//
// SAFETY: default `mode:'draft'` creates a DRAFT registry (autoSend:false) — nothing is dispatched
// until a human confirms on hippo. A real dispatch (`mode:'send'`, autoSend) is only honoured when
// the body ALSO carries `confirm:true`, so no stray/automated call can fire live letters.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const int = (v: unknown): number => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
  const snapshotId = int(body?.snapshotId);
  const firmId = int(body?.firmId);
  if (!snapshotId || !firmId) return NextResponse.json({ error: 'snapshotId va firmId kerak' }, { status: 400 });

  // A real send needs BOTH mode:'send' and confirm:true; anything else is a safe draft.
  const mode: SendMode = body?.mode === 'send' && body?.confirm === true ? 'send' : 'draft';
  const limRaw = Number(body?.limit);
  const limit = Number.isInteger(limRaw) && limRaw > 0 ? limRaw : undefined;

  const result = await sendTalabnomaToHippo({ snapshotId, firmId, mode, limit });
  if (!result.ok) {
    // Missing hippo connection is a 409 (actionable: connect); everything else a 422.
    const status = /ulanmagan/i.test(result.error ?? '') ? 409 : 422;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
