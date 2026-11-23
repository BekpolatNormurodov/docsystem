// Build the MIB report as an .xlsx. To'liq eksport: Mijozlar + Ishlar + kesim varaqlari (Firma /
// Region / Hudud / Bank). `opts.tab` bir kesim varag'ini beradi (dashboard tabidan), `opts.clientId`
// bitta mijozning ishlarini beradi. Kesim/region mantig'i src/lib/mib/breakdown.ts dan (dashboard
// bilan bir xil). Pul haqiqiy son bo'lib yoziladi — Excel yig'a/filtrlay oladi.
import ExcelJS from 'exceljs';
import type { MibCase, MibClient, MibReport } from '@prisma/client';
import { parseMoney } from './stats';
import { groupBreakdown, regionFromText, rowKey, clean, shortFirm, decodeEntities, bestFio, UNKNOWN, type Dim } from './breakdown';

// Ishlarga server sudya va sud ish raqamini qo'shadi (src/lib/mib/judges.ts, attachJudgesToClients).
type CaseRowX = MibCase & { judge?: string | null; courtCaseNumber?: string | null };
// `prior` — natija shu hisobotdan emas, boshqa hisobotdagi oldingi tekshiruvdan olingan (route qo'yadi).
type ClientWithCases = MibClient & { cases: CaseRowX[]; prior?: { reportId: number; checkedAt: Date | null } };
const dmy = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('ru-RU') : '');
const priorNote = (c: ClientWithCases) => (c.prior ? `Oldingi tekshiruvdan${c.prior.checkedAt ? ` (${dmy(c.prior.checkedAt)})` : ''} — bu hisobotda hali navbatda` : '');

const num = (s: string | null) => (s ? parseMoney(s) : 0);
// HTML entity'lar ochiladi («O&#039;G&#039;LI» → «O'G'LI») — bazada eski tortilgan yozuvlarda bor.
// Ortiqcha bo'shliqlar (qo'sh probel, chetdagi probel) ham tozalanadi — Excel'da filtr/qidiruv buzilmasin.
const txt = (s: string | null | undefined) => (s && s !== 'Nomaʼlum' ? decodeEntities(s).replace(/\s+/g, ' ').trim() : '');
const sp = (s: string) => s.replace(/\s+/g, ' ').trim();
// Detali olinmagan ishda summa NOMA'LUM — 0 emas, bo'sh katak (0 «qarzi yo'q» deb o'qilardi).
const numOrBlank = (s: string | null, has: boolean): number | string => (has ? num(s) : '');
// Sarlavha: qalin + fon + muzlatilgan qator + avtofiltr.
// Butunlay bo'sh ustunni olib tashlaydi (masalan manba Excel'da «Ish raqami» / «Holat» bo'lmasa — 100%
// bo'sh ustun «ma'lumot yetishmayapti» degan taassurot berardi). `keep` — doim qoladigan ustun kalitlari.
function dropEmptyColumns(ws: ExcelJS.Worksheet, keep: string[] = []): void {
  for (let ci = ws.columnCount; ci >= 1; ci--) {
    const col = ws.getColumn(ci);
    if (col.key && keep.includes(col.key)) continue;
    let filled = false;
    ws.eachRow((r, i) => { if (i > 1 && !filled) { const v = r.getCell(ci).value; if (v != null && v !== '') filled = true; } });
    if (!filled) ws.spliceColumns(ci, 1);
  }
}

function styleHeader(ws: ExcelJS.Worksheet): void {
  const h = ws.getRow(1);
  h.font = { bold: true };
  h.alignment = { vertical: 'middle', wrapText: true };
  h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (ws.columnCount > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}
const UNK = 'Aniqlanmagan';

const DIMS: Dim[] = ['sudya', 'firma', 'region', 'hudud', 'bank'];
const DIM_SHEET: Record<Dim, string> = { sudya: 'Sudya boʻyicha', firma: 'Firma boʻyicha', region: 'Region boʻyicha', hudud: 'Hudud (MIB)', bank: 'Bank boʻyicha' };
const DIM_HEAD: Record<Dim, string> = { sudya: 'Sudya', firma: 'Firma', region: 'Region', hudud: 'Hudud (MIB boʻlimi)', bank: 'Bank' };

// Kesim varag'i (Firma/Region/Bank/Sudya) — yorliq + kontekst ustuni + son + summa. «Hudud» uchun
// Region ustuni (qaysi viloyat), «Sudya» uchun Sud ustuni (sudya qaysi sudda) qo'shiladi.
function addBreakdownSheet(wb: ExcelJS.Workbook, clients: ClientWithCases[], dim: Dim): void {
  const ws = wb.addWorksheet(DIM_SHEET[dim]);
  const extra = dim === 'hudud' ? { header: 'Region', key: 'region', width: 18 }
    : dim === 'sudya' ? { header: 'Sud', key: 'court', width: 46 } : null;
  // Sudya → eng ko'p uchragan sud nomi.
  const courtOf = new Map<string, string>();
  if (dim === 'sudya') {
    const cnt = new Map<string, Map<string, number>>();
    for (const c of clients) for (const k of c.cases) {
      const j = clean(k.judge), court = txt(k.courtOrgan);
      if (!j || !court) continue;
      const m = cnt.get(j) ?? new Map<string, number>();
      m.set(court, (m.get(court) ?? 0) + 1); cnt.set(j, m);
    }
    for (const [j, m] of cnt) courtOf.set(j, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  }
  ws.columns = [
    { header: DIM_HEAD[dim], key: 'label', width: 46 },
    ...(extra ? [extra] : []),
    { header: 'Ijro ishi', key: 'cases', width: 12 },
    { header: 'Bizniki (MMT)', key: 'ours', width: 14 },
    { header: 'Mijoz', key: 'clients', width: 10 },
    { header: 'Ulush %', key: 'share', width: 10 },
    { header: 'Qoldiq qarz', key: 'debt', width: 20 },
  ];
  const rows = groupBreakdown(clients, dim);
  const totalDebt = rows.reduce((a, r) => a + r.debt, 0) || 1;
  for (const r of rows) {
    const row: Record<string, unknown> = { label: sp(r.label), cases: r.cases, ours: r.ours, clients: r.clients, share: Math.round((r.debt / totalDebt) * 1000) / 10, debt: r.debt };
    if (dim === 'hudud') row.region = regionFromText(r.label) ?? (r.label === UNK ? UNK : ''); // hudud → qaysi viloyat
    if (dim === 'sudya') row.court = courtOf.get(r.label) ?? '';
    ws.addRow(row);
  }
  const t = rows.reduce((a, r) => ({ cases: a.cases + r.cases, ours: a.ours + r.ours, debt: a.debt + r.debt }), { cases: 0, ours: 0, debt: 0 });
  // Jami mijoz — ALOHIDA mijozlar soni (bir mijoz bir necha guruhda bo'lishi mumkin, qo'shib bo'lmaydi).
  const distinct = clients.filter((c) => c.cases.some((k) => dim === 'firma' || rowKey(c, k, dim) !== UNKNOWN)).length;
  ws.addRow({ label: `Jami · ${rows.length} guruh`, cases: t.cases, ours: t.ours, clients: distinct, share: rows.length ? 100 : 0, debt: t.debt });
  styleHeader(ws);
  ws.lastRow!.font = { bold: true };
  ws.getColumn('debt').numFmt = '#,##0';
}

// «Ijrochilar boʻyicha» — FAQAT bizning firma ishlari. Har ijrochi: F.I.O, telefon, MIB boʻlimi (hudud),
// region, ishlar/mijozlar soni, qoldiq qarz. Operator ijrochi bilan bogʻlanishi uchun eng muhim varaq.
function addExecutorSheet(wb: ExcelJS.Workbook, clients: ClientWithCases[]): void {
  const ws = wb.addWorksheet('Ijrochilar boʻyicha');
  ws.columns = [
    { header: 'Davlat ijrochisi', key: 'name', width: 30 },
    { header: 'Telefon', key: 'phone', width: 18 },
    { header: 'MIB boʻlimi (hudud)', key: 'dept', width: 28 },
    { header: 'Region', key: 'region', width: 18 },
    { header: 'Ishlar', key: 'cases', width: 9 },
    { header: 'Mijozlar', key: 'clients', width: 10 },
    { header: 'Qoldiq qarz', key: 'debt', width: 20 },
  ];
  type Agg = { name: string; phone: string; dept: string; region: string; cases: number; clients: Set<number>; debt: number };
  const map = new Map<string, Agg>();
  for (const c of clients) {
    for (const k of c.cases) {
      if (!k.isTargetFirm) continue; // faqat bizniki — ijrochi detali shu ishларда bor
      const name = txt(k.executorName) || UNK;
      const phone = txt(k.executorPhone);
      const dept = txt(k.executorDept) || UNK;
      const key = `${name}|${phone}|${dept}`;
      const a = map.get(key) ?? { name, phone, dept, region: regionFromText(txt(k.executorDept) || txt(k.courtOrgan)) ?? UNK, cases: 0, clients: new Set<number>(), debt: 0 };
      a.cases += 1; a.clients.add(c.id); a.debt += num(k.remainingDebt);
      map.set(key, a);
    }
  }
  const rows = [...map.values()].sort((x, y) => y.debt - x.debt || y.cases - x.cases);
  for (const a of rows) ws.addRow({ name: a.name, phone: a.phone, dept: a.dept, region: a.region, cases: a.cases, clients: a.clients.size, debt: a.debt });
  const t = rows.reduce((s, a) => ({ cases: s.cases + a.cases, debt: s.debt + a.debt }), { cases: 0, debt: 0 });
  const distinct = clients.filter((c) => c.cases.some((k) => k.isTargetFirm)).length;
  ws.addRow({ name: `Jami · ${rows.length} ijrochi`, phone: '', dept: '', region: '', cases: t.cases, clients: distinct, debt: t.debt });
  styleHeader(ws);
  ws.lastRow!.font = { bold: true };
  ws.getColumn('debt').numFmt = '#,##0';
}

export async function buildMibExcel(
  report: MibReport,
  clients: ClientWithCases[],
  opts: { tab?: string; clientId?: number } = {},
): Promise<Buffer> {
  // FAQAT BIZNIKI — butun eksport (Mijozlar + Ishlar + kesimlar) faqat o'z firmalarimiz (isTargetFirm)
  // ishlariga oid: Davlat jarima/pochta xarajati/bank/boshqa kreditor umuman chiqmaydi (2026-09-18,
  // operator talabi). Bizniki ishi yo'q mijoz ham chiqmaydi. Firma kesimи → faqat 3 firma. Bitta mijoz
  // eksporti (opts.clientId) — mustasno, o'sha mijozning HAMMA ishi kerak.
  const oursClients = opts.clientId
    ? clients
    : clients.map((c) => ({ ...c, cases: c.cases.filter((k) => k.isTargetFirm) })).filter((c) => c.cases.length > 0);

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  // Bitta kesim varag'i (dashboard tabidan «Excel») — kesimlar FAQAT BIZNIKI.
  if (opts.tab === 'ijrochilar') {
    addExecutorSheet(wb, oursClients);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  if (opts.tab && DIMS.includes(opts.tab as Dim)) {
    addBreakdownSheet(wb, oursClients, opts.tab as Dim);
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  // ── Sheet 0: Xulosa ─ hisobot qanchalik TO'LIQ ekanini birinchi qarashda ko'rsatadi ─────────────
  // («Excel chala» shikoyati: hisobot hali tekshirilayotgan bo'lsa yoki bizniki ishi yo'q mijozlar
  // Mijozlar varag'iga tushmasa — qatorlar soni ro'yxatnikidan kam ko'rinardi, sababi yozilmagan edi.)
  const isOne = !!opts.clientId;
  if (!isOne) {
    const fresh = clients.filter((c) => !c.prior);
    const priorCnt = clients.length - fresh.length;
    const cnt = (st: string) => fresh.filter((c) => c.status === st).length;
    const checked = cnt('DONE') + cnt('CLEAN');
    const pending = cnt('PENDING') + cnt('RUNNING');
    const oc = oursClients.flatMap((c) => c.cases);
    const detailed = oc.filter((k) => k.detailFetchedAt).length;
    const notary = oc.filter((k) => /нотариус|notarius/i.test(k.courtDocType ?? '')).length;
    const x = wb.addWorksheet('Xulosa');
    x.columns = [{ header: 'Koʻrsatkich', key: 'k', width: 46 }, { header: 'Qiymat', key: 'v', width: 22 }, { header: 'Izoh', key: 'n', width: 70 }];
    const row = (k: string, v: unknown, n = '') => x.addRow({ k, v, n });
    row('Hisobot', txt(report.label) || txt(report.sourceFileName) || `#${report.id}`);
    row('Excel tuzilgan', new Date());
    row('Roʻyxatdagi mijozlar', clients.length);
    row('Tekshirilgan (shu hisobotda)', checked, `${clients.length ? Math.round((checked / clients.length) * 100) : 0}%`);
    row('Oldingi tekshiruvlardan olingan', priorCnt, priorCnt ? 'Bu hisobotda hali navbatda, lekin shu PINFL boshqa hisobotda tekshirilgan — oʻsha natija qoʻyildi («Izoh» ustunida sanasi)' : '');
    row('Hech qachon tekshirilmagan (navbatda)', pending, pending ? 'Hisobot TUGAMAGAN — bu mijozlar «Qolgan mijozlar» varag\'ida, ishlari hali yoʻq' : '');
    row('Xato bilan qolgan', cnt('FAILED'), cnt('FAILED') ? 'Dashboard\'da «Xatolarni davom ettirish» bilan qayta tekshiring' : '');
    row('Bizning firma ishi bor mijozlar', oursClients.length, '«Mijozlar» varag\'i');
    row('Bizning ijro ishlari', oc.length, '«Ishlar» varag\'i (boshqa kreditorlar ishlari kiritilmaydi)');
    row('— detali olingan', detailed, oc.length ? `${Math.round((detailed / oc.length) * 1000) / 10}%` : '');
    row('— detali olinmagan', oc.length - detailed, oc.length - detailed ? 'SMS kod kelmagan — «Izoh» ustunida' : '');
    row('— notarius ijro xati', notary, notary ? 'Sud qarori emas — «Sud ish raqami» / «Sudya» boʻlmaydi' : '');
    row('Bizning qoldiq qarz (soʻm)', oc.reduce((a, k) => a + num(k.remainingDebt), 0));
    x.getColumn('v').numFmt = '#,##0';
    x.getCell('B3').numFmt = 'dd.mm.yyyy hh:mm';
    styleHeader(x);
    x.autoFilter = undefined as never;
    if (pending) x.getRow(7).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFB42318' } }; });
  }

  // ── Sheet 1: Mijozlar ─────────────────────────────────────────────────────
  const s1 = wb.addWorksheet('Mijozlar');
  s1.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'F.I.O', key: 'fio', width: 34 },
    { header: 'Firma', key: 'firm', width: 22 },
    { header: 'Ish raqami (Excel)', key: 'ish', width: 18 },
    { header: 'Holat (Excel)', key: 'holat', width: 26 },
    { header: 'MIB holati', key: 'status', width: 14 },
    { header: 'Ijro ishlari', key: 'cases', width: 12 },
    { header: 'Umumiy summa', key: 'debt', width: 18 },
    { header: 'Qoldiq (jami)', key: 'remaining', width: 18 },
    { header: 'Tekshirilgan', key: 'checked', width: 18 },
    { header: 'Izoh', key: 'note', width: 40 },
  ];
  const STATUS_UZ: Record<string, string> = { PENDING: 'Navbatda', RUNNING: 'Tekshirilmoqda', DONE: 'Topildi', CLEAN: 'Toza', FAILED: 'Xato' };
  for (const c of oursClients) {
    const remaining = c.cases.reduce((s, k) => s + num(k.remainingDebt), 0);
    // «Umumiy summa» — ishlarning I/H summasi yig'indisi (mib.uz qidiruvidagi «umumiy qarzdorlik» amalda
    // doim 0 keladi — ustun butunlay nol bo'lib qolardi). Firma — Excel'da bo'lmasa ishlardagi firmalardan.
    const total = c.cases.reduce((s, k) => s + num(k.totalAmount), 0) || num(c.totalDebt);
    const firms = [...new Set(c.cases.filter((k) => k.isTargetFirm && k.firmName).map((k) => shortFirm(k.firmName!)))].join(', ');
    const missing = c.cases.filter((k) => k.isTargetFirm && !k.detailFetchedAt).length;
    s1.addRow({
      no: c.rowNo ?? '', pinfl: c.pinfl, fio: sp(bestFio(c)), firm: txt(c.firm) || firms, ish: txt(c.ishRaqami), holat: txt(c.holat),
      status: c.prior ? 'Oldingi natija' : STATUS_UZ[c.status] ?? c.status, cases: c.cases.length, debt: total, remaining,
      checked: c.checkedAt ? new Date(c.checkedAt) : '',
      note: [priorNote(c), missing ? `${missing} ta ish detali olinmagan (SMS kelmadi)` : '', opts.clientId ? '' : txt(c.status === 'FAILED' ? c.error : '')].filter(Boolean).join('; '),
    });
  }

  // ── Sheet 2: Ishlar (ijro) — FAQAT BIZNIKI ────────────────────────────────
  const s2 = wb.addWorksheet('Ishlar');
  s2.columns = [
    { header: '№', key: 'no', width: 6 },
    { header: 'PINFL', key: 'pinfl', width: 18 },
    { header: 'F.I.O', key: 'fio', width: 34 },
    { header: 'Ijro ishi raqami', key: 'work', width: 20 },
    { header: 'Undiruvchi (firma)', key: 'firm', width: 40 },
    { header: 'INN', key: 'inn', width: 14 },
    { header: 'Ijroga yuborgan (sud / notarius)', key: 'court', width: 40 },
    { header: 'Sud ish raqami', key: 'courtcase', width: 20 },
    { header: 'Sudya', key: 'judge', width: 32 },
    { header: 'Hujjat turi', key: 'doctype', width: 16 },
    { header: 'Hujjat raqami', key: 'docnum', width: 24 },
    { header: 'Hujjat sanasi', key: 'docdate', width: 14 },
    { header: 'Kuchga kirgan', key: 'eff', width: 14 },
    { header: 'Davlat ijrochisi', key: 'exec', width: 30 },
    { header: 'Ijrochi tel', key: 'execphone', width: 20 },
    { header: 'MIB bo‘limi', key: 'dept', width: 22 },
    { header: 'MIBga kelgan', key: 'received', width: 16 },
    { header: 'Qo‘zg‘atilgan', key: 'initiated', width: 20 },
    { header: 'Umumiy summa', key: 'total', width: 16 },
    { header: 'Asosiy qarz', key: 'main', width: 16 },
    { header: 'Ijro yig‘imi', key: 'fee', width: 14 },
    { header: 'Jarima', key: 'fine', width: 14 },
    { header: 'Qoldiq qarz', key: 'remaining', width: 16 },
    { header: 'Bank', key: 'bank', width: 30 },
    { header: 'MFO', key: 'mfo', width: 10 },
    { header: 'Hisob raqami', key: 'account', width: 24 },
    { header: 'Qarorlar', key: 'decisions', width: 40 },
    { header: 'Tekshirilgan', key: 'checked', width: 16 },
    { header: 'Izoh', key: 'note', width: 30 },
  ];
  for (const c of oursClients) {
    const fullName = sp(bestFio(c));
    if (!c.cases.length) continue;
    for (const k of c.cases) {
      const dec = Array.isArray(k.decisions) ? (k.decisions as { article: string; date: string }[]).map((d) => `${txt(d.article)} (${d.date})`).join('; ') : '';
      const has = !!k.detailFetchedAt; // detal olinmagan ishda summalar noma'lum → bo'sh
      // Notarius ijro xati — sud ishi emas: sud raqami/sudya bo'sh qolishi TABIIY, buni yozib qo'yamiz.
      const notary = /нотариус|notarius/i.test(k.courtDocType ?? '');
      s2.addRow({
        no: c.rowNo ?? '', pinfl: c.pinfl, fio: fullName, work: k.workNumber,
        firm: txt(k.firmName), inn: txt(k.firmInn), court: txt(k.courtOrgan), courtcase: notary ? 'notarius' : txt(k.courtCaseNumber), judge: notary ? '—' : txt(k.judge),
        doctype: txt(k.courtDocType), docnum: txt(k.courtDocNumber),
        docdate: txt(k.courtDocDate), eff: txt(k.courtEffectiveDate), exec: txt(k.executorName), execphone: txt(k.executorPhone), dept: txt(k.executorDept),
        received: txt(k.mibReceivedDate), initiated: txt(k.mibInitiatedDate),
        total: numOrBlank(k.totalAmount, has), main: numOrBlank(k.mainDebt, has), fee: numOrBlank(k.executionFee, has), fine: numOrBlank(k.fine, has), remaining: numOrBlank(k.remainingDebt, has),
        bank: txt(k.bankName), mfo: txt(k.bankMfo), account: txt(k.bankAccount), decisions: dec,
        checked: c.checkedAt ? new Date(c.checkedAt) : '',
        note: [c.prior ? `Oldingi tekshiruvdan${c.prior.checkedAt ? ` (${dmy(c.prior.checkedAt)})` : ''}` : '', has ? '' : `Detal olinmagan${k.error ? ` — ${txt(k.error)}` : ''}`].filter(Boolean).join('; '),
      });
    }
  }

  // Header styling + money number format on both sheets.
  // ── Qolgan mijozlar: ro'yxatdagi, lekin «Mijozlar»ga tushmaganlar (navbatda / xato / toza / faqat
  //    boshqa kreditor) — Excel ro'yxat bilan to'liq solishtirilsin, hech kim «yo'qolib» qolmasin.
  let s3: ExcelJS.Worksheet | null = null;
  if (!isOne) {
    const inOurs = new Set(oursClients.map((c) => c.id));
    const rest = clients.filter((c) => !inOurs.has(c.id));
    if (rest.length) {
      s3 = wb.addWorksheet('Qolgan mijozlar');
      s3.columns = [
        { header: '№', key: 'no', width: 6 }, { header: 'PINFL', key: 'pinfl', width: 18 }, { header: 'F.I.O', key: 'fio', width: 34 },
        { header: 'Firma', key: 'firm', width: 14 }, { header: 'Holat', key: 'status', width: 26 }, { header: 'Boshqa kreditor ishlari', key: 'other', width: 14 },
        { header: 'Tekshirilgan', key: 'checked', width: 18 }, { header: 'Izoh', key: 'note', width: 50 },
      ];
      const ORDER: Record<string, number> = { FAILED: 0, PENDING: 1, RUNNING: 1, DONE: 2, CLEAN: 3 };
      rest.sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || (a.rowNo ?? 0) - (b.rowNo ?? 0));
      for (const c of rest) {
        const label = c.status === 'DONE' ? 'Bizning firma ishi yoʻq' : c.status === 'CLEAN' ? 'MIBda qarzi yoʻq (toza)' : c.status === 'FAILED' ? 'Xato' : 'Hali tekshirilmagan';
        s3.addRow({
          no: c.rowNo ?? '', pinfl: c.pinfl, fio: sp(bestFio(c)), firm: txt(c.firm), status: label,
          other: c.status === 'DONE' ? c.cases.filter((k) => !k.isTargetFirm).length : '',
          checked: c.checkedAt ? new Date(c.checkedAt) : '', note: c.prior ? priorNote(c) : c.status === 'FAILED' ? txt(c.error) : '',
        });
      }
      s3.getColumn('checked').numFmt = 'dd.mm.yyyy hh:mm';
    }
  }

  ['debt', 'remaining'].forEach((k) => { const col = s1.getColumn(k); col.numFmt = '#,##0'; });
  ['total', 'main', 'fee', 'fine', 'remaining'].forEach((k) => { const col = s2.getColumn(k); col.numFmt = '#,##0'; });
  s1.getColumn('checked').numFmt = 'dd.mm.yyyy hh:mm';
  s2.getColumn('checked').numFmt = 'dd.mm.yyyy';
  dropEmptyColumns(s1, ['no', 'pinfl', 'fio', 'status', 'cases']);
  dropEmptyColumns(s2, ['no', 'pinfl', 'fio', 'work']);
  if (s3) dropEmptyColumns(s3, ['no', 'pinfl', 'fio', 'status']);
  for (const ws of [s1, s2, ...(s3 ? [s3] : [])]) styleHeader(ws);

  // To'liq hisobotga kesim varaqlarini ham qo'shamiz (bitta mijoz eksportida shart emas).
  // «Ijrochilar boʻyicha» — birinchi kesim varaq (eng koʻp soʻraladi), so'ng firma/region/hudud/bank.
  if (!opts.clientId) { addExecutorSheet(wb, oursClients); for (const d of DIMS) addBreakdownSheet(wb, oursClients, d); }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
