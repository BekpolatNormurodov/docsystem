// One-off: render ONE case's full court packet to a folder + list contents. Read-only (no DB writes).
// Run: npx tsx scripts/gen-court-packet.ts <caseId> [outDir]
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { buildCasePacket } from '../src/lib/konveyer-packet';

async function main() {
  const caseId = Number(process.argv[2] || 9);
  const outDir = process.argv[3] || `./_packet-${caseId}`;
  const browser = await chromium.launch();
  try {
    const pkt = await buildCasePacket(caseId, { browser, talabnomaPdf: true, includeFirmDocs: true, includeGrafik: false });
    if (!pkt) { console.log('Packet null (no pinfl/snapshot/debt).'); return; }
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of pkt.files) fs.writeFileSync(path.join(outDir, f.name), f.buf);
    console.log(`Case ${caseId} — ${pkt.folder} — ${pkt.firmName}`);
    console.log(`talabnomaMade=${pkt.talabnomaMade} arizaMade=${pkt.arizaMade}`);
    console.log(`Files (${pkt.files.length}) → ${outDir}:`);
    for (const f of pkt.files) console.log(`  ${(f.buf.length / 1024).toFixed(0).padStart(6)} KB  ${f.name}`);
  } finally { await browser.close(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
