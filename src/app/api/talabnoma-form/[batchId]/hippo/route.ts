import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getStoredHippoSession } from '@/lib/hippo/session';
import { resolveContext, checkBalanceFor, createRegistryInternal } from '@/lib/hippo/xat';
import { talabnomaRowsToMails } from '@/lib/hippo/talabnoma-send';
import { FIRMS } from '@/lib/firms';
import { readCandidates } from '@/lib/talabnoma-form/parse';
import { buildRowsForFirm } from '@/lib/talabnoma-form/generate';
import { canonCode, isReadyFirm, DEFAULT_THRESHOLD } from '@/lib/talabnoma-form/filter';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST { firmCode, mode:'draft'|'send', confirm, thresholdTotal, perFirmMin, includeUnready, limit? }
// Standalone xat.hippo registry from the uploaded data (no snapshot). SAFETY mirrors the pipeline:
// default mode 'draft' (autoSend:false) — a real dispatch needs mode:'send' AND confirm:true.
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const user = await requireAccess('talabnoma-form');
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'batchId noto‘g‘ri' }, { status: 400 });

  const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id }, select: { candidatesPath: true, status: true } });
  if (!batch?.candidatesPath || batch.status !== 'READY') return NextResponse.json({ error: 'Batch tayyor emas' }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const firmCode = String(body?.firmCode ?? '').trim();
  if (!firmCode) return NextResponse.json({ error: 'firmCode majburiy' }, { status: 400 });
  const includeUnready = body?.includeUnready === true;
  if (!isReadyFirm(firmCode) && !includeUnready) {
    return NextResponse.json({ needsConfirm: true, error: 'Firma to‘liq forma tayyor emas — tasdiqlang' }, { status: 409 });
  }

  const firm = FIRMS.find((f) => canonCode(f.branchCode) === canonCode(firmCode));
  if (!firm?.stir) return NextResponse.json({ error: 'Bu firma xat.hippo uchun sozlanmagan (STIR yo‘q)' }, { status: 422 });

  const thresholdTotal = numOr(body?.thresholdTotal, DEFAULT_THRESHOLD);
  const perFirmMin = numOr(body?.perFirmMin, 0);
  const limit = Number.isInteger(Number(body?.limit)) && Number(body?.limit) > 0 ? Number(body?.limit) : undefined;

  const file = await readCandidates(batch.candidatesPath);
  let rows = buildRowsForFirm(file, firmCode, { thresholdTotal, perFirmMin });
  if (!rows.length) return NextResponse.json({ error: 'Yuboriladigan qator yo‘q' }, { status: 422 });
  if (limit) rows = rows.slice(0, limit);

  let session;
  try {
    session = await getStoredHippoSession(firm.stir.replace(/\D+/g, ''));
  } catch {
    return NextResponse.json({ error: 'xat.hippo ga ulanmagan — E-IMZO orqali ulang' }, { status: 409 });
  }

  // Pin this firm's exact talabnoma template (Urban 119 / Bright 42 / Community 123) — see firms.ts.
  const ctx = await resolveContext(session, 'talabnoma', firm.hippoTemplateId);
  if (!ctx.organizationId) return NextResponse.json({ error: 'hippo konteksti aniqlanmadi (organizationId yo‘q)' }, { status: 422 });

  const mode = body?.mode === 'send' && body?.confirm === true ? 'send' : 'draft';
  const autoSend = mode === 'send';

  if (autoSend) {
    const bal = await checkBalanceFor(session, rows.length);
    if (!bal.enough) {
      return NextResponse.json({ error: `Balans yetarli emas — ${bal.shortfall} so‘m kam`, balance: bal }, { status: 422 });
    }
  }

  const mails = talabnomaRowsToMails(rows, ctx.templateName);
  const res = await createRegistryInternal(session, {
    organizationId: ctx.organizationId,
    branchId: ctx.branchId,
    autoSend,
    mails,
  });
  const j = (res as any)?.json ?? {};
  // HTTP 200 with an error envelope (e.g. «Invalid targeting setup.») must NOT count as success.
  const errText = j?.error ?? j?.message ?? (j?.success === false ? 'xat.hippo rad etdi' : null);
  const registryId = j?.id ?? j?.data?.id ?? null;
  if (errText && !registryId) {
    await prisma.talabnomaFormRun.create({
      data: { batchId: id, createdBy: user.username, kind: 'HIPPO', firmCode, firmName: firm.name, filters: { thresholdTotal, perFirmMin, includeUnready }, status: 'FAILED', message: String(errText) },
    });
    return NextResponse.json({ error: String(errText) }, { status: 422 });
  }

  const run = await prisma.talabnomaFormRun.create({
    data: {
      batchId: id, createdBy: user.username, kind: 'HIPPO', firmCode, firmName: firm.name,
      filters: { thresholdTotal, perFirmMin, includeUnready, mode },
      status: 'DONE', rowCount: rows.length, personCount: rows.length,
      hippoRegistryId: registryId != null ? String(registryId) : null,
      message: autoSend ? 'Yuborildi (autoSend)' : 'Qoralama yaratildi',
    },
  });

  return NextResponse.json({ runId: run.id, registryId, mode, count: rows.length });
}

function numOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
