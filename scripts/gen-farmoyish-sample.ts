// One-off: render a farmoyish .docx from the real URBAN reference data → scratchpad, to eyeball the form.
import { writeFileSync } from 'node:fs';
import { renderFarmoyishDocx, FARMOYISH_SIGNERS } from '../src/lib/farmoyish-docx';

async function main() {
  const signers = FARMOYISH_SIGNERS['06292'];
  const buf = await renderFarmoyishDocx({
    legalName: '«URBAN FINANCE SOLUTIONS MIKROMOLIYA TASHKILOTI» MCHJ',
    district: 'Учтепа тумани',
    phone: '99-772-92-77',
    date: new Date('2026-08-07T00:00:00Z'),
    address: 'Toshkent shahar, Olmazor tumani, Chinniobod MFY, Chinniobod-2 mavzesi, 7-uy',
    stir: '311 943 592',
    bankAccount: '20216000307206292001',
    mfo: '01183',
    directorName: signers?.director,
    executorName: signers?.executor,
    rows: [
      { clientName: "TURDALIYEV SAMANDAR SAFARALI O'G'LI", kod: '60123092', receiptNumber: '262160984965' },
      { clientName: "XO'JAMNAZAROV G'OLIBJON SHUKURJON O'G'LI", kod: '60122396', receiptNumber: '262162348624' },
      { clientName: "XOSHIMOV BEKZODBEK ERKINJON O'G'LI", kod: '60123859', receiptNumber: '262168671390' },
      { clientName: 'VYATKINA YEVGENIYA PAVLOVNA', kod: '60123760', receiptNumber: '262178849783' },
      { clientName: 'YULDASHEV ILXOM IBRAGIMOVICH', kod: '60134424', receiptNumber: '262178964254' },
    ],
  });
  const out = process.argv[2] || 'farmoyish-sample.docx';
  writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
