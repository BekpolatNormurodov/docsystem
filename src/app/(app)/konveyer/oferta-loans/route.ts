import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/job-dispatch';
import { awaitJob } from '@/lib/await-job';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_LOANS = 300;
// Fayl nomi: harf/raqam/probel/nuqta/chiziqcha qoladi, qolgani «_». Nomlar aniq bo'lsin — mijoz
// ismi + shartnoma raqami har PDF'da (papkadan chiqarib olinsa ham adashmasin).
const clean = (s: string, n = 80) => (s || '').replace(/[^\p{L}\p{N}. ()ʻ'’-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim();
const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').trim() || 'oferta';
const disposition = (name: string) => `attachment; filename="${ascii(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// GET ?loanIds=1,2,3 — mijoz sahifasidagi «Oferta» yuklab olish (ish/case shart emas — 03.11 kabi
// ishsiz snapshotlarda ham ishlaydi). Chromium render worker'da: OFERTA job (loanIds) → kutamiz →
//   • bitta kredit  → bitta PDF: «Oferta <shartnoma> — <F.I.Sh>.pdf»
//   • bir nechta    → ZIP «Oferta — <F.I.Sh> <PINFL>.zip»; ichida har PDF shu nom bilan, bir nechta firma
//                     bo'lsa firma papkalari bilan.
export async function GET(req: NextRequest) {
  await requireUser();
  const t = getT();
  const ids = [...new Set((req.nextUrl.searchParams.get('loanIds') ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) return NextResponse.json({ error: t('loanIds kerak') }, { status: 400 });
  if (ids.length > MAX_LOANS) return NextResponse.json({ error: t('Juda koʻp shartnoma') }, { status: 400 });

  const loans = await prisma.loan.findMany({
    where: { id: { in: ids } },
    select: { id: true, snapshotId: true, pinfl: true, clientName: true, ldId: true, branchCode: true, summKr: true },
  });
  if (!loans.length) return NextResponse.json({ error: t('Shartnoma topilmadi') }, { status: 404 });
  // Bitta yuklash — bitta mijoz (aralash so'rovni rad etamiz).
  if (new Set(loans.map((l) => `${l.snapshotId}|${l.pinfl}`)).size > 1) return NextResponse.json({ error: t('Shartnomalar bitta mijozniki boʻlishi kerak') }, { status: 400 });
  const withSum = loans.filter((l) => Number(l.summKr) > 0);
  if (!withSum.length) return NextResponse.json({ error: t('Hujjat topilmadi') }, { status: 404 });

  const job = await prisma.job.create({
    data: { type: 'OFERTA', status: 'PENDING', snapshotId: loans[0]!.snapshotId, total: withSum.length, params: { loanIds: withSum.map((l) => l.id), insurancePct: 0 } },
  });
  enqueueJob(job.id);
  const r = await awaitJob(job.id);
  if (r === 'TIMEOUT') return NextResponse.json({ error: t('Oferta navbatda — katta partiya tugagach qayta urinib koʻring') }, { status: 504 });
  if (r === 'FAILED') return NextResponse.json({ error: t('Oferta yaratilmadi') }, { status: 500 });

  const zipPath = path.join(process.cwd(), 'exports', `${job.id}.zip`);
  if (!fs.existsSync(zipPath)) return NextResponse.json({ error: t('Oferta yaratilmadi') }, { status: 500 });
  const src = await JSZip.loadAsync(fs.readFileSync(zipPath));

  const firms = await prisma.firm.findMany({ where: { code: { in: [...new Set(withSum.map((l) => l.branchCode).filter((c): c is string => !!c))] } }, select: { code: true, shortName: true } });
  const firmName = new Map(firms.map((f) => [f.code, clean(f.shortName || f.code || 'Firma', 40)]));
  const fio = clean(loans[0]!.clientName || 'Mijoz', 70);
  const pinfl = loans[0]!.pinfl ?? '';
  // runOfertaJobByLoans nomlari: «<FIRMA>/<F.I.Sh PINFL>/oferta_<ld>.pdf» → ld bo'yicha kreditni topamiz.
  const key = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '');
  const byLd = new Map(withSum.map((l) => [key(String(l.ldId ?? l.id)), l]));
  const files: { firm: string; name: string; buf: Buffer }[] = [];
  for (const e of Object.values(src.files)) {
    if (e.dir || !e.name.toLowerCase().endsWith('.pdf')) continue;
    const base = e.name.split('/').pop()!.replace(/\.pdf$/i, '');
    const ld = base.replace(/^oferta_/, '').replace(/ \(\d+\)$/, '');
    const loan = byLd.get(key(ld));
    const firm = (loan?.branchCode && firmName.get(loan.branchCode)) || clean(e.name.split('/')[0] || 'Firma', 40);
    files.push({ firm, name: `Oferta ${clean(String(loan?.ldId ?? ld), 40)} — ${fio}.pdf`, buf: await e.async('nodebuffer') });
  }
  if (!files.length) return NextResponse.json({ error: t('Hujjat topilmadi') }, { status: 404 });

  if (ids.length === 1 && files.length === 1) {
    const f = files[0]!;
    return new NextResponse(new Uint8Array(f.buf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition(f.name), 'Content-Length': String(f.buf.length) },
    });
  }

  const multiFirm = new Set(files.map((f) => f.firm)).size > 1;
  const out = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let p = multiFirm ? `${f.firm}/${f.name}` : f.name;
    for (let k = 2; used.has(p); k++) p = (multiFirm ? `${f.firm}/` : '') + f.name.replace(/\.pdf$/, ` (${k}).pdf`);
    used.add(p);
    out.file(p, f.buf);
  }
  const buf = await out.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const scope = multiFirm ? '' : ` ${files[0]!.firm}`;
  const name = `Oferta${scope} — ${fio}${pinfl ? ` ${pinfl}` : ''}.zip`;
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition(name), 'Content-Length': String(buf.length) },
  });
}
