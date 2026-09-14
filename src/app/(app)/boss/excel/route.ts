import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireAdmin } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { bossReport, type BossReportData } from '@/lib/boss-report';

export const runtime = 'nodejs';
export const maxDuration = 120;

function buildBossExcel(d: BossReportData, snapLabel: string): Buffer | Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const bold1 = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const money = (ws: ExcelJS.Worksheet, key: string) => { ws.getColumn(key).numFmt = '#,##0'; };
  const t = d.totals;

  // 1) Firmalar — to'liq matritsa
  const s1 = wb.addWorksheet('Firmalar');
  s1.columns = [
    { header: 'Firma', key: 'firma', width: 32 },
    { header: 'Mijozlar', key: 'cli', width: 11 },
    { header: 'Talabnoma', key: 'tal', width: 12 },
    { header: 'Sanoat palatasi', key: 'san', width: 15 },
    { header: 'Sud: koʻrib chiqishda', key: 'sr', width: 18 },
    { header: 'Sud: qanoatlantirilgan', key: 'sg', width: 20 },
    { header: 'Sud: qaytarilgan', key: 'sret', width: 15 },
    { header: 'Sud: rad qilingan', key: 'srej', width: 15 },
    { header: 'Sudga jami', key: 'sjami', width: 12 },
    { header: 'MIBga', key: 'mib', width: 10 },
    { header: 'Jami qarz', key: 'debt', width: 18 },
  ];
  for (const f of d.firms) s1.addRow({ firma: f.firmName, cli: f.clients, tal: f.talabnoma, san: f.sanoat, sr: f.sud.inReview, sg: f.sud.granted, sret: f.sud.returned, srej: f.sud.rejected, sjami: f.sud.total, mib: f.mib, debt: f.debt });
  s1.addRow({ firma: 'JAMI', cli: t.clients, tal: t.talabnoma, san: t.sanoat, sr: t.sud.inReview, sg: t.sud.granted, sret: t.sud.returned, srej: t.sud.rejected, sjami: t.sud.total, mib: t.mib, debt: t.debt });
  bold1(s1); s1.lastRow!.font = { bold: true }; money(s1, 'debt');

  // 2) Sud statuslari — firma bo'yicha 4 holat
  const s2 = wb.addWorksheet('Sud statuslari');
  s2.columns = [
    { header: 'Firma', key: 'firma', width: 32 },
    { header: 'Koʻrib chiqishda', key: 'sr', width: 16 },
    { header: 'Qanoatlantirilgan', key: 'sg', width: 18 },
    { header: 'Qaytarilgan', key: 'sret', width: 14 },
    { header: 'Rad qilingan', key: 'srej', width: 14 },
    { header: 'Jami', key: 'sjami', width: 10 },
  ];
  for (const f of d.firms) s2.addRow({ firma: f.firmName, sr: f.sud.inReview, sg: f.sud.granted, sret: f.sud.returned, srej: f.sud.rejected, sjami: f.sud.total });
  s2.addRow({ firma: 'JAMI', sr: t.sud.inReview, sg: t.sud.granted, sret: t.sud.returned, srej: t.sud.rejected, sjami: t.sud.total });
  bold1(s2); s2.lastRow!.font = { bold: true };

  // 3) Bosqichlar (jami) — vertikal funnel
  const s3 = wb.addWorksheet('Bosqichlar');
  s3.columns = [{ header: 'Bosqich', key: 'step', width: 32 }, { header: 'Soni', key: 'val', width: 14 }];
  s3.addRow({ step: '1. Talabnoma', val: t.talabnoma });
  s3.addRow({ step: '2. Sanoat palatasi', val: t.sanoat });
  s3.addRow({ step: '3. Sudga chiqarilgan (jami)', val: t.sud.total });
  s3.addRow({ step: '   — koʻrib chiqishda', val: t.sud.inReview });
  s3.addRow({ step: '   — qanoatlantirilgan', val: t.sud.granted });
  s3.addRow({ step: '   — qaytarilgan', val: t.sud.returned });
  s3.addRow({ step: '   — rad qilingan', val: t.sud.rejected });
  s3.addRow({ step: '4. MIBga chiqarilgan', val: t.mib });
  bold1(s3);

  // 4) Umumiy xulosa
  const s4 = wb.addWorksheet('Umumiy');
  s4.columns = [{ header: 'Koʻrsatkich', key: 'k', width: 34 }, { header: 'Qiymat', key: 'v', width: 20 }];
  s4.addRow({ k: 'Snapshot (sana)', v: snapLabel });
  s4.addRow({ k: 'Firmalar soni', v: d.firms.length });
  s4.addRow({ k: 'Mijozlar (kishi) soni', v: t.clients });
  s4.addRow({ k: 'Jami ishlar', v: t.total });
  s4.addRow({ k: 'Talabnoma yuborilgan', v: t.talabnoma });
  s4.addRow({ k: 'Sanoat palatasida', v: t.sanoat });
  s4.addRow({ k: 'Sudga chiqarilgan', v: t.sud.total });
  s4.addRow({ k: 'MIBga chiqarilgan', v: t.mib });
  s4.addRow({ k: 'Jami qarz (soʻm)', v: t.debt });
  bold1(s4); s4.getColumn('v').numFmt = '#,##0';

  // 5) Viloyat kesimi — MIBga + Sud
  const s5 = wb.addWorksheet('Viloyatlar');
  s5.columns = [
    { header: 'Viloyat', key: 'reg', width: 22 },
    { header: 'Mijozlar', key: 'cli', width: 11 },
    { header: 'MIBga', key: 'mib', width: 12 },
    { header: 'Sudga (jami)', key: 'sud', width: 14 },
    { header: 'Qanoatlantirilgan', key: 'gr', width: 18 },
    { header: 'Qaytarilgan', key: 'ret', width: 14 },
    { header: 'Jami qarz', key: 'debt', width: 18 },
  ];
  for (const r of d.regions) s5.addRow({ reg: r.region, cli: r.clients, mib: r.mib, sud: r.sudTotal, gr: r.granted, ret: r.returned, debt: r.debt });
  const rt = d.regions.reduce((a, r) => ({ cli: a.cli + r.clients, mib: a.mib + r.mib, sud: a.sud + r.sudTotal, gr: a.gr + r.granted, ret: a.ret + r.returned, debt: a.debt + r.debt }), { cli: 0, mib: 0, sud: 0, gr: 0, ret: 0, debt: 0 });
  s5.addRow({ reg: 'JAMI', cli: rt.cli, mib: rt.mib, sud: rt.sud, gr: rt.gr, ret: rt.ret, debt: rt.debt });
  bold1(s5); s5.lastRow!.font = { bold: true }; money(s5, 'debt');

  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b as ArrayBuffer));
}

export async function GET(req: NextRequest) {
  await requireAdmin();
  const snaps = await konveyerSnapshots().catch(() => []);
  const q = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = q ? Number(q) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const snapLabel = snaps.find((s) => s.id === selectedId)?.label ?? '—';

  const data = await bossReport(selectedId);
  const buf = await buildBossExcel(data, snapLabel);
  const name = `Boshliq_hisoboti_${snapLabel.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
