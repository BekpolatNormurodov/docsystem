// Admin one-off: register the firm-library court documents (guvohnoma/ishonchnoma/shartnoma) that
// were shared via Telegram, so they attach to every client's court packet. DRY by default; pass
// --commit to copy files into exports/firm-docs/<firmId>/ and upsert FirmDocument rows (one per
// firm+kind, mirroring the /konveyer/firm-doc upload route).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, type FirmDocKind } from '@prisma/client';

const prisma = new PrismaClient();
const SRC = '/Users/khurshid28/Downloads/Telegram Desktop';
const DEST = path.join(process.cwd(), 'exports', 'firm-docs');
const commit = process.argv.includes('--commit');

const FILES: { file: string; firm: string; kind: FirmDocKind }[] = [
  { file: 'Guvoxnoma BRIGHT.pdf', firm: 'bright', kind: 'GUVOHNOMA' },
  { file: 'Ishonchnoma BRIGHT.pdf', firm: 'bright', kind: 'ISHONCHNOMA' },
  { file: 'Shartnoma BRIGHT.pdf', firm: 'bright', kind: 'SHARTNOMA' },
  { file: 'Community guvohnoma.pdf', firm: 'community', kind: 'GUVOHNOMA' },
  { file: 'Community Shartnoma.pdf', firm: 'community', kind: 'SHARTNOMA' },
  { file: 'Fundflow guvohnoma.pdf', firm: 'fundflow', kind: 'GUVOHNOMA' },
  { file: 'Fundflow shartnoma.pdf', firm: 'fundflow', kind: 'SHARTNOMA' },
  { file: 'Urban guvohnoma.pdf', firm: 'urban', kind: 'GUVOHNOMA' },
  { file: 'Urban shartnoma.pdf', firm: 'urban', kind: 'SHARTNOMA' },
];

(async () => {
  const firms = await prisma.firm.findMany({ select: { id: true, code: true, shortName: true, legalName: true } });
  console.log('=== FIRMS ===');
  for (const f of firms) console.log(`${f.id} | code=${f.code} | short=${f.shortName} | legal=${f.legalName}`);

  const matchFirm = (kw: string) => {
    const hits = firms.filter((f) => [f.shortName, f.legalName, f.code].some((v) => (v ?? '').toLowerCase().includes(kw)));
    return hits.length === 1 ? hits[0] : (hits.length > 1 ? { ambiguous: hits } as any : null);
  };

  console.log('\n=== PLAN ===');
  const plan: { firmId: number; firmName: string; kind: FirmDocKind; src: string }[] = [];
  for (const it of FILES) {
    const firm = matchFirm(it.firm);
    const src = path.join(SRC, it.file);
    const exists = fs.existsSync(src);
    if (!firm) { console.log(`❌ ${it.file} → firm "${it.firm}" NOT FOUND`); continue; }
    if ('ambiguous' in firm) { console.log(`❌ ${it.file} → firm "${it.firm}" AMBIGUOUS: ${firm.ambiguous.map((f: any) => `${f.id}:${f.shortName}`).join(', ')}`); continue; }
    if (!exists) { console.log(`❌ ${it.file} → file MISSING at ${src}`); continue; }
    console.log(`✓ ${it.file}  →  firm ${firm.id} (${firm.shortName})  ·  ${it.kind}`);
    plan.push({ firmId: firm.id, firmName: firm.shortName ?? String(firm.id), kind: it.kind, src });
  }

  if (!commit) { console.log(`\n(DRY RUN — ${plan.length}/9 matched; re-run with --commit to write)`); await prisma.$disconnect(); return; }

  console.log('\n=== COMMIT ===');
  for (const p of plan) {
    const dir = path.join(DEST, String(p.firmId));
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(p.src);
    const dest = path.join(dir, `${p.kind}-${base.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`);
    fs.copyFileSync(p.src, dest);
    const old = await prisma.firmDocument.findMany({ where: { firmId: p.firmId, kind: p.kind }, select: { id: true, filePath: true } });
    const doc = await prisma.firmDocument.create({ data: { firmId: p.firmId, kind: p.kind, label: base, filePath: dest } });
    for (const o of old) { try { if (o.filePath !== dest) fs.rmSync(o.filePath, { force: true }); } catch {} }
    if (old.length) await prisma.firmDocument.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    console.log(`✓ firm ${p.firmId} ${p.kind} → doc #${doc.id}  (${dest})`);
  }
  console.log(`\nDONE — ${plan.length} firm docs registered.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
