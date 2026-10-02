import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { enqueueJob } from '@/lib/job-dispatch';
import { readCandidates } from '@/lib/talabnoma-form/parse';
import { applyRunOptions, buildRowsForFirm, isStaleCandidates, parseAmountMode, writeReyestr, writeAllFirmsReyestr } from '@/lib/talabnoma-form/generate';
import { isReadyFirm, DEFAULT_THRESHOLD } from '@/lib/talabnoma-form/filter';
import { reyestrXlsxPath } from '@/lib/talabnoma-form/store';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST { firmCode, firmName?, kind: 'REYESTR'|'LETTERS', thresholdTotal, perFirmMin, includeUnready }
//  · a non-ready firm (∉ Bright/Urban/Community) is BLOCKED unless includeUnready:true → the client
//    shows the «qolgani ketsinmi?» confirm first (returns 409 needsConfirm otherwise).
//  · REYESTR is built inline (fast); LETTERS goes to a background job (chromium PDF).
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const user = await requireAccess('talabnoma-form');
  const t = getT();
  const id = Number(params.batchId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: t('batchId noto‘g‘ri') }, { status: 400 });

  const batch = await prisma.talabnomaFormBatch.findUnique({ where: { id }, select: { candidatesPath: true, status: true } });
  if (!batch) return NextResponse.json({ error: t('Batch topilmadi') }, { status: 404 });
  if (batch.status !== 'READY' || !batch.candidatesPath) return NextResponse.json({ error: t('Batch tayyor emas') }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const all = body?.all === true; // «Barcha firmalar — bitta Excel»
  const firmCode = String(body?.firmCode ?? '').trim();
  if (!firmCode && !all) return NextResponse.json({ error: t('firmCode majburiy') }, { status: 400 });
  const kind = body?.kind === 'LETTERS' ? 'LETTERS' : 'REYESTR';
  const thresholdTotal = numOr(body?.thresholdTotal, DEFAULT_THRESHOLD);
  const perFirmMin = numOr(body?.perFirmMin, 0);
  const includeUnready = body?.includeUnready === true;
  const opts = { thresholdTotal, perFirmMin };
  const filtersAll = { thresholdTotal, perFirmMin, includeUnready: true };
  // Operator tanlovi: hujjat sanasi (YYYY-MM-DD; bo'sh/xato → candidates'dagi asl sana) va xatdagi summa
  // turi (amount: 'total' jami | 'overdue' faqat muddati o'tgan). Inline yo'llarda applyRunOptions,
  // fon job'larga params'da — ikkalasi bir xil qoida (generate.applyRunOptions).
  const docDate = typeof body?.docDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.docDate) ? body.docDate : undefined;
  const amount = parseAmountMode(body?.amount);
  const runOpts = { docDate, amount };
  // Tarix/yuklab olingan fayl nomida variant ko'rinsin («… · muddati o'tgan»); jami — belgisiz.
  const variantTag = amount === 'overdue' ? ` · ${t('muddati o‘tgan')}` : '';

  // Eski parser bilan tahlil qilingan (shartnoma sanasi bo'sh, muddati o'tgan summa yo'q) → yuklangan
  // fayllardan avtomatik qayta tahlil; UI PARSING holatini kuzatadi, tugagach operator qayta bosadi.
  const candidates = await readCandidates(batch.candidatesPath);
  if (isStaleCandidates(candidates)) {
    await prisma.talabnomaFormBatch.update({ where: { id }, data: { status: 'PARSING', processedRows: 0, totalRows: 0, message: null } });
    const job = await prisma.job.create({ data: { type: 'TALABNOMA_FORM', status: 'PENDING', total: 1, params: { action: 'parse', batchId: id } } });
    enqueueJob(job.id);
    return NextResponse.json(
      { reparsing: true, error: t('Tahlil yangilanmoqda (yangi maydonlar: shartnoma sanasi, muddati o‘tgan summa, Unikalka) — tugagach qayta bosing.') },
      { status: 409 },
    );
  }

  // «Barcha firmalar — hammasi bittada»: Excel (bitta varaq) yoki PDF (bitta fayl, firmalar ichida).
  if (all) {
    const format = body?.format === 'zip' ? 'zip' : 'excel';
    if (format === 'zip') {
      // Firma bo'yicha ZIP (har firma alohida papka) — chromium og'ir, fon jarayoni; Tarixdan yuklanadi.
      const run = await prisma.talabnomaFormRun.create({
        data: { batchId: id, createdBy: user.username, kind: 'LETTERS', firmCode: '__ALL__', firmName: t('Barcha firmalar (ZIP)') + variantTag, filters: { ...filtersAll, amount }, status: 'PENDING' },
      });
      const job = await prisma.job.create({
        data: { type: 'TALABNOMA_FORM', status: 'PENDING', params: { action: 'generate-all-zip', batchId: id, runId: run.id, filters: opts, ...runOpts } },
      });
      enqueueJob(job.id);
      return NextResponse.json({ runId: run.id, jobId: job.id, kind: 'LETTERS' });
    }
    // Bitta Excel — tez, inline.
    const file = candidates;
    applyRunOptions(file, runOpts);
    const run = await prisma.talabnomaFormRun.create({
      data: { batchId: id, createdBy: user.username, kind: 'REYESTR', firmCode: '__ALL__', firmName: t('Barcha firmalar') + variantTag, filters: { ...filtersAll, amount }, status: 'RUNNING' },
    });
    const outPath = reyestrXlsxPath(id, run.id);
    const count = await writeAllFirmsReyestr(file, opts, outPath);
    if (!count) {
      await prisma.talabnomaFormRun.update({ where: { id: run.id }, data: { status: 'FAILED', message: t('Tanlangan filtr uchun qator yo‘q') } }).catch(() => {});
      return NextResponse.json({ error: t('Tanlangan filtr uchun qator yo‘q') }, { status: 422 });
    }
    await prisma.talabnomaFormRun.update({ where: { id: run.id }, data: { status: 'DONE', rowCount: count, personCount: count, resultPath: outPath } });
    return NextResponse.json({ runId: run.id, rowCount: count, kind: 'REYESTR' });
  }

  const ready = isReadyFirm(firmCode);
  if (!ready && !includeUnready) {
    return NextResponse.json(
      { needsConfirm: true, error: t('Bu firma to‘liq forma tayyor emas — tasdiqlang') },
      { status: 409 },
    );
  }

  const firmName = (String(body?.firmName ?? '') || firmCode) + variantTag;
  const filters = { thresholdTotal, perFirmMin, includeUnready, amount };

  if (kind === 'REYESTR') {
    const file = candidates;
    applyRunOptions(file, runOpts);
    const rows = buildRowsForFirm(file, firmCode, opts);
    if (!rows.length) return NextResponse.json({ error: t('Tanlangan filtr uchun qator yo‘q') }, { status: 422 });
    const run = await prisma.talabnomaFormRun.create({
      data: { batchId: id, createdBy: user.username, kind: 'REYESTR', firmCode, firmName, filters, status: 'RUNNING' },
    });
    const outPath = reyestrXlsxPath(id, run.id);
    await writeReyestr(rows, outPath);
    await prisma.talabnomaFormRun.update({
      where: { id: run.id },
      data: { status: 'DONE', rowCount: rows.length, personCount: rows.length, resultPath: outPath },
    });
    return NextResponse.json({ runId: run.id, rowCount: rows.length, kind: 'REYESTR' });
  }

  // LETTERS — background job.
  const run = await prisma.talabnomaFormRun.create({
    data: { batchId: id, createdBy: user.username, kind: 'LETTERS', firmCode, firmName, filters, status: 'PENDING' },
  });
  const job = await prisma.job.create({
    data: {
      type: 'TALABNOMA_FORM',
      status: 'PENDING',
      params: { action: 'generate-letters', batchId: id, runId: run.id, firmCode, filters: opts, ...runOpts },
    },
  });
  enqueueJob(job.id);
  return NextResponse.json({ runId: run.id, jobId: job.id, kind: 'LETTERS' });
}

function numOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
