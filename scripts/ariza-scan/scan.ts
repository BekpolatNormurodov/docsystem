// Scan an ariza's text and FILTER out only the necessary (variable) parts — the
// bits that differ from the fixed form: qarzdor (name/address/PINFL/phone),
// contracts, rate(s), total credit, and the 4-part debt breakdown + jami.
//
// Input: a .txt with the ariza text (the 2 reference arizas are scanned IMAGE PDFs
// with no text layer, so the text was read via vision → a57.txt / a42.txt). For a
// TEXT ariza (docx/pdf) pipe `pdftotext file.pdf -` output in instead.
import fs from 'node:fs';

const money = /([\d][\d   ]*,\d{2}|[\d][\d   ]*\d)/; // "49 761 951,91" or "80 600 000"
const clean = (s: string) => s.replace(/[   ]+/g, ' ').trim();
const num = (s: string) => Number(s.replace(/[^\d,]/g, '').replace(',', '.'));

// The address starts at the first region/city token; everything before it in the
// Qarzdor block is the person's name.
const ADDR_START = /(Toshkent|Buxoro|Farg|Andijon|Namangan|Samarqand|Jizzax|Sirdaryo|Surxondaryo|Qashqadaryo|Navoiy|Xorazm|Qoraqalpog)/u;

// Map a firm name found in the ariza to the app's short firm key.
const FIRM_KEYS: [RegExp, string][] = [
  [/BRIGHT/i, 'BRIGHT'], [/URBAN/i, 'URBAN'], [/COMMUNITY/i, 'COMMUNITY'],
  [/MUVAFFAQIYAT/i, 'MUVAFFAQIYAT'], [/FUNDFLOW/i, 'FUNDFLOW'],
];

export interface ArizaFields {
  clientName: string;
  address: string;
  pinfl: string;
  phone: string;
  firm: string;      // firm name as printed in the ariza («…» block)
  firmKey: string;   // normalized: BRIGHT / URBAN / COMMUNITY / MUVAFFAQIYAT / FUNDFLOW
  contracts: { date: string; number: string }[];
  rates: string[];
  totalCredit: number | null;
  debt: { asosiy: number | null; muddatliFoiz: number | null; otganQarz: number | null; otganFoiz: number | null; jami: number | null };
}

export function scanAriza(text: string): ArizaFields {
  const t = clean(text.replace(/\r?\n/g, ' '));

  // Qarzdor block: between "Qarzdor:" and "JShShIR:"
  const qb = (t.match(/Qarzdor:\s*(.+?)\s*JShShIR:/i) || [])[1] ?? '';
  const am = qb.match(ADDR_START);
  const clientName = clean(am ? qb.slice(0, am.index) : qb);
  const address = clean(am ? qb.slice(am.index!) : '');

  const pinfl = (t.match(/JShShIR:\s*(\d{14})/i) || [])[1] ?? '';
  const phone = (t.match(/Tel:\s*(\+?\d[\d ]+)/i) || [])[1]?.replace(/\s/g, '') ?? '';

  // Firm — the «…» quoted lender name (the "undiruvchi" / collector).
  const firm = clean((t.match(/«([^»]+(?:FINANCING|SOLUTIONS|MICROFINANCE|MIKROMOLIYA|MUVAFFAQIYAT|FUNDFLOW)[^»]*)»/i) || [])[1] ?? '');
  const firmKey = (FIRM_KEYS.find(([re]) => re.test(firm)) || [, ''])[1] as string;

  // Contracts: "DD.MM.YYYY-yildagi NUMBER-sonli"
  const contracts = [...t.matchAll(/(\d{2}\.\d{2}\.\d{4})-yildagi\s+([\d-]+)-sonli/gi)].map((m) => ({ date: m[1], number: m[2] }));
  // Rates: "yillik NN%"
  const rates = [...new Set([...t.matchAll(/yillik\s+(\d{1,3})%/gi)].map((m) => m[1] + '%'))];
  // Total credit: "jami … soʻm miqdorida kredit"
  const totalCredit = (() => { const m = t.match(/jami\s+([\d   ]+)\s*so.?m miqdorida kredit/i); return m ? num(m[1]) : null; })();

  const grab = (label: RegExp) => { const m = t.match(new RegExp(label.source + '[^\\d-]*-?\\s*' + money.source, 'iu')); return m ? num(m[1]) : null; };
  const debt = {
    asosiy: grab(/Asosiy qarz qoldig.?i/),
    muddatliFoiz: grab(/Muddatli foizlar qarzdorligi/),
    otganQarz: grab(/Muddati o.?tgan qarz qarzdorligi/),
    otganFoiz: grab(/Muddati o.?tgan foizlar qarzdorligi/),
    jami: (() => { const m = t.match(/Jami qarzdorligi\s+([\d   ]+,\d{2})/i); return m ? num(m[1]) : null; })(),
  };

  return { clientName, address, pinfl, phone, firm, firmKey, contracts, rates, totalCredit, debt };
}

// CLI: scan each .txt passed as an argument.
if (process.argv[2]) {
  for (const file of process.argv.slice(2)) {
    const f = scanAriza(fs.readFileSync(file, 'utf8'));
    console.log(`\n===== ${file} =====`);
    console.log('Ism        :', f.clientName);
    console.log('PINFL      :', f.pinfl);
    console.log('FIRMA      :', f.firmKey || '?', `(${f.firm})`);
    console.log('Telefon    :', f.phone);
    console.log('MANZIL     :', f.address);
    console.log('Shartnoma  :', f.contracts.map((c) => `${c.date}/${c.number}`).join(', '), `(${f.contracts.length} ta)`);
    console.log('Foiz       :', f.rates.join(', '));
    console.log('Jami kredit:', f.totalCredit?.toLocaleString('ru-RU'));
    console.log('Qarz       : asosiy', f.debt.asosiy?.toLocaleString('ru-RU'),
      '| muddatli-foiz', f.debt.muddatliFoiz?.toLocaleString('ru-RU'),
      '| oʻtgan-qarz', f.debt.otganQarz?.toLocaleString('ru-RU'),
      '| oʻtgan-foiz', f.debt.otganFoiz?.toLocaleString('ru-RU'));
    console.log('JAMI qarz  :', f.debt.jami?.toLocaleString('ru-RU'));
    // reconcile check
    const sum = [f.debt.asosiy, f.debt.muddatliFoiz, f.debt.otganQarz, f.debt.otganFoiz].reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    console.log('  breakdown yigʻindisi =', sum?.toLocaleString('ru-RU'), sum && f.debt.jami && Math.abs(sum - f.debt.jami) < 0.01 ? '✓ JAMI ga mos' : '✗');
  }
}
