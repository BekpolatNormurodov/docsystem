// «Sud buyrug'i» Excel — ADOLAT holatlari bo'yicha tanlangan ishlarni sudga topshiriladigan
// buyruq-formatida (11 ustunli namuna: Davogar/Javobgar/manzil/pasport/JSHSHIR/da'vo summasi/pochta/boji)
// chiqaradi. Manba: ClientCaseStatus (CABINET sync) + Loan portfeli (asosiy qarz, manzil, pasport, PINFL).
// «Da'vo summasi» = ASOSIY QARZ (debtPrincipal + muddati o'tgan asosiy); davlat boji = 4% (formula).
// Tug'ilgan sana PINFL'dan chiqariladi. Bir firma — bir varaq.
import ExcelJS from 'exceljs';
import { prisma } from './db';

// ADOLAT holati → o'zbekcha yorliq. BUYRUQ_STATUSES — sahifadagi tanlov ro'yxati (tartib bo'yicha).
export const STATUS_UZ: Record<string, string> = {
  CREATED: 'Yaratilgan (yuborilmagan)',
  REGISTER: 'Roʻyxatga olingan',
  ALLOCATE: 'Taqsimlangan',
  PENDING: 'Kutilmoqda',
  IN_PROCESS: 'Koʻrib chiqilmoqda',
  DECIDED: 'Qaror chiqarilgan',
  FINISHED: 'Yakunlangan',
  DECLINED: 'Rad etilgan',
  RETURNED: 'Qaytarilgan',
};
export const BUYRUQ_STATUSES = Object.keys(STATUS_UZ);

// «Hammasi» tanlanganda default sifatida ishlatiladigan 4 ta asosiy firma kodi (buyruq oqimi
// aynan shularga tegishli): BRIGHT / URBAN / COMMUNITY / MUVAFFAQIYAT. Foydalanuvchi so'rovi:
// «4 ta bilan cheklansin». Boshqa firmalar (FUNDFLOW/ZAYMLY/…) shovqin qilmasin.
export const BUYRUQ_DEFAULT_FIRMS = ['12842', '06292', '55890', '05557'] as const;

const norm = (s?: string | null) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[''`ʻʼ‘’]/g, "'").replace(/\s+/g, ' ')
    .replace(/\s*O'G'LI|\s*QIZI|\s*UGLI|\s*ULI/g, '').trim();

// PINFL (JShShIR) ichida tug'ilgan sana kodlangan: 1-raqam asr/jins, 2-7 raqamlar DDMMYY.
const birthFromPinfl = (p?: string | null): string => {
  const s = String(p || '').replace(/\D/g, '');
  if (s.length !== 14) return '';
  const d1 = s[0]!, dd = s.slice(1, 3), mm = s.slice(3, 5), yy = s.slice(5, 7);
  const c = d1 === '1' || d1 === '2' ? 1800 : d1 === '5' || d1 === '6' ? 2000 : 1900;
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return '';
  return `${dd}.${mm}.${c + +yy}`;
};

interface FirmIdx { byPinfl: Map<string, IdxRow>; byName: Map<string, IdxRow> }
interface IdxRow {
  principal: number; // ASOSIY QARZ QOLDIG'I: FAQAT debtPrincipal (muddati o'tgan asosiy YO'Q, foizlar YO'Q)
  pinfl: string; passport: string; address: string;
}

// Bir firma portfelidan (PINFL va nom bo'yicha) qarzdorlik indeksini quramiz. Foydalanuvchi
// so'rovi: «arizada berilgan» summa — ariza (CourtArizaDocument) qatorida «Asosiy qarz qoldigʻi»
// aynan `debtPrincipal` bo'yicha yoziladi. Muddati o'tgan asosiy va foizlar arizaда ALOHIDA
// qatorlar. Shu shablon Excel oddiy 11 ustunli — undi kesim yo'q, shuning uchun faqat asosiy
// qarz qoldig'ini (debtPrincipal) yozamiz.
async function firmIndex(branchCode: string): Promise<FirmIdx> {
  // MUHIM: kredit ID (ldId) bo'yicha unik olamiz. Bir kredit har portfel yuklaganда YANGI
  // snapshotда qayta yoziladi (eski snapshot loans qoladi) — filtrsiz bir kredit har snapshot
  // uchun 1 marta chiqib jamlanardi (2026-09-22 audit: XUSHMURODOV 98M → 198M). `distinct:['ldId']`
  // + `orderBy:{snapshotId:desc}` bilan har kredit ENG SO'NGGI snapshotdan bir marta olinadi —
  // portfel yangilansa qarz avtomatik yangilanadi, dublikat yo'q. Ariza (court-submit-job.ts)
  // ham snapshotId bilan filtrlaydi, biz bundan kuchliroq: kredit-scoped.
  const loans = await prisma.loan.findMany({
    where: { branchCode },
    select: {
      ldId: true, clientName: true, pinfl: true, passportSn: true, postAddressUz: true, postAddress: true,
      debtPrincipal: true,
    },
    orderBy: [{ ldId: 'asc' }, { snapshotId: 'desc' }],
    distinct: ['ldId'],
  });
  const byPinfl = new Map<string, IdxRow>(), byName = new Map<string, IdxRow>();
  const add = (m: Map<string, IdxRow>, k: string, l: (typeof loans)[number]) => {
    if (!k) return;
    const a = m.get(k) ?? { principal: 0, pinfl: '', passport: '', address: '' };
    a.principal += Number(l.debtPrincipal || 0);
    if (!a.pinfl && l.pinfl) a.pinfl = l.pinfl;
    if (!a.passport && l.passportSn) a.passport = l.passportSn;
    const ad = l.postAddress && l.postAddress.length > (l.postAddressUz || '').length ? l.postAddress : l.postAddressUz || l.postAddress || '';
    if (ad.length > a.address.length) a.address = ad;
    m.set(k, a);
  };
  for (const l of loans) { if (l.pinfl) add(byPinfl, l.pinfl, l); add(byName, norm(l.clientName), l); }
  return { byPinfl, byName };
}

const dfmt = (d: Date | null): string =>
  d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} йил` : '';

export interface BuyruqOpts { branchCodes: string[]; statuses: string[] }

// Ustun sarlavhalari (kiril/lotin variantlar) → 1-asoslangan ustun indeksi.
const HEADER_ALIASES: Record<string, string[]> = {
  no: ['№', 'N'],
  davogar: ['Davogar', "Da'vogar", 'Даъвогар', 'Давогар'],
  javobgar: ['Javobgar', 'Жавобгар'],
  manzil: ['MANZILI', 'Manzil', 'Манзил', 'Манзили'],
  birth: ['Tugilgan kun oy yil', "Tug'ilgan", 'Тугилган кун ой йил'],
  passport: ['Pasport', 'Паспорт'],
  pinfl: ['JSHSHIR', 'JShShIR', 'ЖШШИР', 'PINFL', 'ПИНФЛ'],
  claimDate: ["Davo ariza sanasi", "Da'vo ariza sanasi", "Даъво ариза санаси", 'Даъво санаси'],
  // ASOSIY QARZDORLIK — agar shablonda alohida shu ustun bo'lsa, principal AYNAN shu yerga
  // yoziladi (Da'vo summasiga tegilmaydi). Foydalanuvchi so'rovi: «da'vo summasi xato chiqyabdi,
  // u asosiy qarzdorlikda». Da'vo summasi ustuni ixtiyoriy — bo'sh bo'lsa foydalanuvchi o'zi
  // yozadi (masalan, principal + foizlar yig'indisi).
  mainDebt: ['Asosiy qarzdorlik', 'Asosiy qarz', 'Основной долг', 'Асосий қарздорлик', 'Асосий қарз', 'Мижоз ссуда қолдиғи', 'ссуда қолдиғи'],
  claim: ["Da'vo summasi", 'Даъво суммаси'],
  post: ['Pochta xarajati summasi', 'Почта харажати суммаси'],
  boji: ['davlat boji', 'davlat boj', 'Давлат божи'],
};
const normHdr = (s: string) => s.toLowerCase().replace(/[\s.'`ʻʼ‘’]/g, '').replace(/[йи]/g, 'и');
function findCol(header: (string | null)[], key: keyof typeof HEADER_ALIASES): number {
  const wanted = HEADER_ALIASES[key]!.map(normHdr);
  for (let i = 0; i < header.length; i++) { const h = header[i]; if (h && wanted.includes(normHdr(h))) return i + 1; }
  return 0;
}

export interface FillTemplateResult { buffer: Buffer; total: number; filled: number; unmatched: number }

// Foydalanuvchi bergan Excel (Буйрук уч намуна ...) ni o'qib, Javobgar ustunidagi ismlar bo'yicha
// tanlangan firma(lar) portfelidan asosiy qarz + manzil + pasport + PINFL ni to'ldirib qaytaradi.
// «Da'vo summasi» = asosiy qarz; «davlat boji» = ROUND(Da'vo summasi * 4%, 0) formula bilan yoziladi
// (agar shablon formula bo'lsa saqlanadi). Boshqa ustunlar va format saqlanib qoladi.
export async function fillBuyruqTemplate(input: Buffer, opts: { branchCodes?: string[]; birthAsText?: boolean } = {}): Promise<FillTemplateResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excelda varaq topilmadi');

  const header: (string | null)[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const v = cell.value as any;
    header[col - 1] = v == null ? '' : (typeof v === 'object' ? String(v.result ?? v.text ?? '') : String(v));
  });
  const cJav = findCol(header, 'javobgar');
  const cAddr = findCol(header, 'manzil');
  const cBirth = findCol(header, 'birth');
  const cPass = findCol(header, 'passport');
  const cPinfl = findCol(header, 'pinfl');
  const cMain = findCol(header, 'mainDebt');   // «Asosiy qarzdorlik» — bor bo'lsa AYNAN shu ustunga
  const cClaim = findCol(header, 'claim');     // «Da'vo summasi» — mainDebt yo'q bo'lsa fallback
  const cBoji = findCol(header, 'boji');
  if (!cJav) throw new Error('«Javobgar» ustuni topilmadi');
  // Asosiy qarzni AYNAN qaysi ustunga yozamiz. mainDebt bor bo'lsa u; aks holda claim.
  const cPrincipal = cMain || cClaim;
  if (!cPrincipal) throw new Error('«Asosiy qarzdorlik» yoki «Da\'vo summasi» ustuni topilmadi');

  // Firma portfellarini birlashtirib bitta indeks (ism bo'yicha). branchCodes berilmasa
  // 4 ta asosiy firma (BRIGHT/URBAN/COMMUNITY/MUVAFFAQIYAT) bo'ylab qidiramiz — buyruq oqimi
  // aynan shu firmalarga tegishli, boshqa firmalar (FUNDFLOW/ZAYMLY/…) ismini «tortib» ketmasin.
  const codes = opts.branchCodes?.length ? opts.branchCodes : [...BUYRUQ_DEFAULT_FIRMS];
  const merged = new Map<string, IdxRow>();
  for (const code of codes) {
    const idx = await firmIndex(code);
    for (const [k, v] of idx.byName) {
      const cur = merged.get(k);
      if (!cur) merged.set(k, { ...v });
      else if (v.principal > cur.principal) merged.set(k, { ...v }); // eng katta qarzli firma — asosiy variant
    }
  }
  const look = (name: string) => merged.get(norm(name)) ?? merged.get(norm(name).replace(/^U/, "O'")) ?? merged.get(norm(name).replace(/^O'/, 'U'));

  let filled = 0, unmatched = 0, total = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nameCell = row.getCell(cJav).value as any;
    const name = nameCell == null ? '' : (typeof nameCell === 'object' ? String(nameCell.result ?? nameCell.text ?? '') : String(nameCell)).trim();
    if (!name) continue;
    total++;
    const hit = look(name);
    if (!hit) { unmatched++; continue; }
    if (cAddr) row.getCell(cAddr).value = hit.address || row.getCell(cAddr).value || '';
    if (cBirth) row.getCell(cBirth).value = birthFromPinfl(hit.pinfl) || row.getCell(cBirth).value || '';
    if (cPass) row.getCell(cPass).value = hit.passport || row.getCell(cPass).value || '';
    if (cPinfl) row.getCell(cPinfl).value = hit.pinfl || row.getCell(cPinfl).value || '';
    const principal = Math.round(hit.principal);
    // Foydalanuvchi so'rovi: «foizlar kerak emas, asosiy qarz bo'lsa bo'ldi». Ikkala ustunga
    // ham (Asosiy qarzdorlik VA Da'vo summasi) asosiy qarzni (principal) yozamiz — foizlar
    // qo'shilmaydi. Foydalanuvchi qo'lda yozgan qiymatga tegilmaydi — bo'sh katakchalar to'ladi.
    const setIfEmpty = (col: number, v: number) => {
      const cell = row.getCell(col);
      const cur = cell.value;
      if (cur == null || cur === '') cell.value = v;
    };
    if (cMain) setIfEmpty(cMain, principal);
    if (cClaim) setIfEmpty(cClaim, principal);
    // Agar ikkalasi ham topilmasa (cPrincipal — cMain yoki cClaim'ning fallback'i), hech bo'lmasa
    // shu ustunni to'ldirib qo'yamiz — juda eski shablon bo'lsa.
    if (!cMain && !cClaim) setIfEmpty(cPrincipal, principal);
    if (cBoji) {
      // Boji formulasi: shablondagi formula saqlanadi. Bo'lmasa Asosiy qarzdorlikka havola qilamiz
      // (foydalanuvchi so'rovi: boji asosiy qarzdan hisoblansin, Da'vo summasidan emas).
      const cur = row.getCell(cBoji).value as any;
      const hasFormula = cur && typeof cur === 'object' && ('formula' in cur || 'sharedFormula' in cur);
      if (!hasFormula) row.getCell(cBoji).value = { formula: `ROUND(${ws.getColumn(cPrincipal).letter}${r}*0.04,0)`, result: Math.round(principal * 0.04) };
    }
    filled++;
  }
  // Format
  const money = '#,##0';
  if (cMain) ws.getColumn(cMain).numFmt = money;
  if (cClaim) ws.getColumn(cClaim).numFmt = money;
  if (cBoji) ws.getColumn(cBoji).numFmt = money;
  if (cPinfl) ws.getColumn(cPinfl).numFmt = '@';
  if (cBirth) ws.getColumn(cBirth).numFmt = '@';

  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return { buffer, total, filled, unmatched };
}

// Tanlangan firma(lar) va holat(lar) bo'yicha buyruq Excel'ini quradi. Har firma — bir varaq.
export async function buildBuyruqExcel(opts: BuyruqOpts): Promise<{ buffer: Buffer; counts: Record<string, number> }> {
  const statuses = opts.statuses.filter((s) => BUYRUQ_STATUSES.includes(s));
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = 'Yurist Tizimi';
  const firms = await prisma.firm.findMany({ where: { code: { in: opts.branchCodes } }, select: { code: true, shortName: true }, orderBy: { id: 'asc' } });
  const counts: Record<string, number> = {};

  for (const f of firms) {
    const cases = await prisma.clientCaseStatus.findMany({
      where: { source: 'CABINET', branchCode: f.code, status: { in: statuses } },
      select: { clientName: true, pinfl: true, caseNumber: true, status: true, defAddress: true, defPassport: true, registryDt: true },
      orderBy: { clientName: 'asc' },
    });
    const idx = await firmIndex(f.code);
    const safe = (f.shortName || f.code).slice(0, 28).replace(/[\\/?*[\]:]/g, '');
    const ws = wb.addWorksheet(safe || f.code);
    ws.columns = [
      { header: '№', width: 5 }, { header: "Da'vogar", width: 26 }, { header: 'Javobgar', width: 30 },
      { header: 'MANZILI', width: 34 }, { header: 'Tugilgan kun oy yil', width: 14 }, { header: 'Pasport', width: 12 },
      { header: 'JSHSHIR', width: 16 }, { header: "Da'vo ariza sanasi", width: 14 }, { header: "Da'vo summasi", width: 15 },
      { header: 'Pochta xarajati summasi', width: 14 }, { header: 'davlat boji', width: 14 }, { header: 'Holat', width: 22 },
      { header: 'Ish raqami', width: 20 },
    ];
    let i = 0;
    for (const c of cases) {
      const hit = (c.pinfl ? idx.byPinfl.get(c.pinfl) : null)
        ?? idx.byName.get(norm(c.clientName))
        ?? idx.byName.get(norm(c.clientName).replace(/^U/, "O'"))
        ?? idx.byName.get(norm(c.clientName).replace(/^O'/, 'U'));
      const principal = hit ? Math.round(hit.principal) : null;
      const pinfl = c.pinfl || hit?.pinfl || '';
      const r = i + 2;
      ws.addRow([
        ++i, f.shortName, c.clientName, c.defAddress || hit?.address || '', birthFromPinfl(pinfl),
        c.defPassport || hit?.passport || '', pinfl, dfmt(c.registryDt), principal, 22000,
        principal != null ? { formula: `ROUND(I${r}*0.04,0)`, result: Math.round(principal * 0.04) } : null,
        STATUS_UZ[c.status] || c.status, c.caseNumber || '',
      ]);
    }
    ws.getRow(1).font = { bold: true };
    ws.getColumn(5).numFmt = '@'; ws.getColumn(7).numFmt = '@';
    ws.getColumn(9).numFmt = '#,##0'; ws.getColumn(10).numFmt = '#,##0'; ws.getColumn(11).numFmt = '#,##0';
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    counts[f.shortName] = cases.length;
  }

  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return { buffer, counts };
}

// ── Per-firma + ZIP ─────────────────────────────────────────────────────────────
import archiver from 'archiver';

export interface PerFirmZipResult {
  buffer: Buffer;
  perFirm: { code: string; shortName: string; total: number; filled: number; unmatched: number }[];
}

// Foydalanuvchi shablon Excel'ini yuklaydi va «Hammasi» tanlaydi — tizim shablonni HAR firma
// alohida ishlaydi: mos ismlar shu firma portfelidan to'ldiriladi. Har firma uchun alohida
// .xlsx yaratamiz va ZIP qilamiz. «Sanitized» firma nomi ustki faylni fayl tizimi belgilaridan
// himoyalash uchun. branchCodes berilmasa BUYRUQ_DEFAULT_FIRMS (4 ta asosiy) ishlaydi.
export async function fillBuyruqPerFirmZip(input: Buffer, branchCodes?: string[]): Promise<PerFirmZipResult> {
  const codes = branchCodes?.length ? branchCodes : [...BUYRUQ_DEFAULT_FIRMS];
  const firms = await prisma.firm.findMany({
    where: { code: { in: codes } },
    select: { code: true, shortName: true },
    orderBy: { id: 'asc' },
  });
  const perFirm: PerFirmZipResult['perFirm'] = [];
  const files: { name: string; buf: Buffer }[] = [];
  for (const f of firms) {
    const res = await fillBuyruqTemplate(input, { branchCodes: [f.code] });
    perFirm.push({ code: f.code, shortName: f.shortName, total: res.total, filled: res.filled, unmatched: res.unmatched });
    // Fayl nomida qonuniy belgilarni saqlaymiz; ZIP standarti (IBM437/CP437) em-dash'ni buzadi,
    // shuning uchun oddiy ASCII tire — va Windows/Mac fayl tizimi cheklovlari.
    const safe = (f.shortName || f.code).replace(/[\\/?*[\]:"<>|]/g, '').trim().slice(0, 60);
    files.push({ name: `${safe || f.code} - buyruq.xlsx`, buf: res.buffer });
  }

  const chunks: Buffer[] = [];
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('warning', (e) => e.code === 'ENOENT' ? undefined : reject(e));
    archive.on('error', reject);
  });
  for (const f of files) archive.append(f.buf, { name: f.name });
  await archive.finalize();
  await done;
  return { buffer: Buffer.concat(chunks), perFirm };
}
