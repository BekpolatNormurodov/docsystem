import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { buildCasePacket, markPacketGenerated } from '@/lib/konveyer-packet';
import type { Browser } from 'playwright';
import type { CaseStage } from '@prisma/client';

export const runtime = 'nodejs';
export const maxDuration = 300;

const zipHeaders = (name: string) => ({
  'Content-Type': 'application/zip',
  'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.zip"`,
});

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

// GET ?caseId= — one-click FULL packet for a single case, streamed as a ZIP that
// mirrors the manual folder (Talabnoma xlsx+pdf, Ariza docx, firm docs, uploads).
export async function GET(req: NextRequest) {
  await requireAdmin();
  const caseId = Number(req.nextUrl.searchParams.get('caseId'));
  if (!caseId) return NextResponse.json({ error: 'caseId kerak' }, { status: 400 });

  let browser: Browser | null = null;
  let packet;
  try {
    browser = await launchBrowser();
    packet = await buildCasePacket(caseId, { browser, talabnomaPdf: true });
  } catch (e) {
    console.error('gen-packet GET failed', e);
    return NextResponse.json({ error: 'Paket yaratilmadi' }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  if (!packet) return NextResponse.json({ error: 'Case yoki portfel maʼlumoti yoʻq' }, { status: 404 });
  if (packet.files.length === 0) return NextResponse.json({ error: 'Hujjat shakllanmadi' }, { status: 400 });

  const zip = new JSZip();
  const dir = zip.folder(packet.folder)!;
  for (const f of packet.files) dir.file(f.name, f.buf);
  const out = await zip.generateAsync({ type: 'nodebuffer' });

  await markPacketGenerated(caseId, packet.talabnomaMade, packet.arizaMade);
  return new NextResponse(new Uint8Array(out), { headers: zipHeaders(packet.folder) });
}

// POST { caseIds?: number[]; firmId?; snapshotId?; stages?; talabnomaPdf? }
// Bulk "umumiy yaratish": one big ZIP with a subfolder per person. Resolves an
// explicit caseIds list (from the UI) or falls back to a firm/stage filter.
export async function POST(req: NextRequest) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const withPdf = body.talabnomaPdf !== false;

  let caseIds: number[] = Array.isArray(body.caseIds) ? body.caseIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [];
  if (!caseIds.length) {
    // Validate the fallback filter BEFORE the query so bad input is a clean 400,
    // not an uncaught PrismaClientValidationError 500.
    const VALID_STAGES = new Set<string>(['IMPORTED', 'TALABNOMA_SENT', 'ARIZA_GENERATED', 'PRINTED', 'CHAMBER_SENT', 'CHAMBER_RETURNED', 'SIGNED_SCANNED', 'INVOICE_CREATED', 'INVOICE_PAID', 'COURT_SUBMITTED', 'COURT_ACCEPTED', 'COURT_RETURNED', 'MIB_SUBMITTED', 'CLOSED']);
    const stages = (Array.isArray(body.stages) ? body.stages : []).filter((s: unknown) => typeof s === 'string' && VALID_STAGES.has(s)) as CaseStage[];
    const firmId = body.firmId != null ? Number(body.firmId) : undefined;
    const snapshotId = body.snapshotId != null ? Number(body.snapshotId) : undefined;
    if ((firmId !== undefined && !Number.isFinite(firmId)) || (snapshotId !== undefined && !Number.isFinite(snapshotId))) {
      return NextResponse.json({ error: 'firmId/snapshotId notoʻgʻri' }, { status: 400 });
    }
    // Require a narrowing filter so a stray/invalid body can't accidentally
    // generate packets for the ENTIRE table.
    if (firmId === undefined && snapshotId === undefined && stages.length === 0) {
      return NextResponse.json({ error: 'caseIds yoki firmId/stages kerak' }, { status: 400 });
    }
    try {
      const rows = await prisma.arizaCase.findMany({
        where: {
          ...(firmId !== undefined ? { firmId } : {}),
          ...(snapshotId !== undefined ? { snapshotId } : {}),
          ...(stages.length ? { stage: { in: stages } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      caseIds = rows.map((r) => r.id);
    } catch (e) {
      console.error('gen-packet fallback query failed', e);
      return NextResponse.json({ error: 'So‘rov xatosi' }, { status: 400 });
    }
  }

  // Bound the synchronous request: PDF rendering is the slow step, and each packet
  // re-embeds the firm library — keep the count low so aggregate memory stays sane.
  const LIMIT = withPdf ? 40 : 100;
  const capped = caseIds.slice(0, LIMIT);
  const dropped = caseIds.length - capped.length;

  const zip = new JSZip();
  const used = new Set<string>();
  // Defer the stage-advance until the ZIP actually exists: if generateAsync throws
  // ("ZIP juda katta"), we must NOT leave cases marked generated (which would
  // permanently block regeneration) for a document that was never delivered.
  const toMark: { id: number; talabnomaMade: boolean; arizaMade: boolean }[] = [];
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    for (const id of capped) {
      const p = await buildCasePacket(id, { browser, talabnomaPdf: withPdf });
      if (!p || p.files.length === 0) continue;
      let folder = p.folder;
      for (let i = 2; used.has(folder); i++) folder = `${p.folder} (${i})`;
      used.add(folder);
      const dir = zip.folder(folder)!;
      for (const f of p.files) dir.file(f.name, f.buf);
      toMark.push({ id, talabnomaMade: p.talabnomaMade, arizaMade: p.arizaMade });
    }
  } catch (e) {
    console.error('gen-packet POST failed', e);
    return NextResponse.json({ error: 'Paketlar yaratilmadi' }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const made = toMark.length;
  if (made === 0) return NextResponse.json({ error: 'Hech qanday paket shakllanmadi' }, { status: 400 });
  let out: Buffer;
  try {
    out = await zip.generateAsync({ type: 'nodebuffer' });
  } catch (e) {
    console.error('gen-packet zip generate failed', e);
    return NextResponse.json({ error: 'ZIP juda katta — kamroq tanlang' }, { status: 500 });
  }

  // ZIP is in hand — advance the cases as a best-effort step. markPacketGenerated
  // is idempotent (talabnomaAt:null / stage:IMPORTED guards), so if a mark fails we
  // still deliver the ZIP and a later run self-heals rather than dropping the packet.
  try {
    for (const m of toMark) await markPacketGenerated(m.id, m.talabnomaMade, m.arizaMade);
  } catch (e) {
    console.error('gen-packet marking failed (ZIP still delivered)', e);
  }
  return new NextResponse(new Uint8Array(out), {
    headers: { ...zipHeaders(`Paketlar_${made}ta`), 'X-Generated': String(made), 'X-Dropped': String(dropped) },
  });
}
