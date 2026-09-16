import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import ExcelJS from 'exceljs';
import { requireAdmin } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { bossReport, type BossReportData } from '@/lib/boss-report';
import { getT } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

function buildBossExcel(d: BossReportData, snapLabel: string, t: ReturnType<typeof getT>): Buffer | Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const bold1 = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const money = (ws: ExcelJS.Worksheet, key: string) => { ws.getColumn(key).numFmt = '#,##0'; };
  const tt = d.totals;

  // 1) Firmalar — to'liq matritsa
  const s1 = wb.addWorksheet(t('Firmalar'));
  s1.columns = [
    { header: t('Firma'), key: 'firma', width: 32 },
    { header: t('Mijozlar'), key: 'cli', width: 11 },
    { header: t('Talabnoma'), key: 'tal', width: 12 },
    { header: t('Sanoat palatasi'), key: 'san', width: 15 },
    { header: t('Sud: koʻrib chiqishda'), key: 'sr', width: 18 },
    { header: t('Sud: qanoatlantirilgan'), key: 'sg', width: 20 },
    { header: t('Sud: qaytarilgan'), key: 'sret', width: 15 },
    { header: t('Sud: rad qilingan'), key: 'srej', width: 15 },
    { header: t('Sudga jami'), key: 'sjami', width: 12 },
    { header: t('MIBga'), key: 'mib', width: 10 },
    { header: t('Jami qarz'), key: 'debt', width: 18 },
  ];
  for (const f of d.firms) s1.addRow({ firma: f.firmName, cli: f.clients, tal: f.talabnoma, san: f.sanoat, sr: f.sud.inReview, sg: f.sud.granted, sret: f.sud.returned, srej: f.sud.rejected, sjami: f.sud.total, mib: f.mib, debt: f.debt });
  s1.addRow({ firma: t('JAMI'), cli: tt.clients, tal: tt.talabnoma, san: tt.sanoat, sr: tt.sud.inReview, sg: tt.sud.granted, sret: tt.sud.returned, srej: tt.sud.rejected, sjami: tt.sud.total, mib: tt.mib, debt: tt.debt });
  bold1(s1); s1.lastRow!.font = { bold: true }; money(s1, 'debt');

  // 2) Sud statuslari — firma bo'yicha 4 holat
  const s2 = wb.addWorksheet(t('Sud statuslari'));
  s2.columns = [
    { header: t('Firma'), key: 'firma', width: 32 },
    { header: t('Koʻrib chiqishda'), key: 'sr', width: 16 },
    { header: t('Qanoatlantirilgan'), key: 'sg', width: 18 },
    { header: t('Qaytarilgan'), key: 'sret', width: 14 },
    { header: t('Rad qilingan'), key: 'srej', width: 14 },
    { header: t('Jami'), key: 'sjami', width: 10 },
  ];
  for (const f of d.firms) s2.addRow({ firma: f.firmName, sr: f.sud.inReview, sg: f.sud.granted, sret: f.sud.returned, srej: f.sud.rejected, sjami: f.sud.total });
  s2.addRow({ firma: t('JAMI'), sr: tt.sud.inReview, sg: tt.sud.granted, sret: tt.sud.returned, srej: tt.sud.rejected, sjami: tt.sud.total });
  bold1(s2); s2.lastRow!.font = { bold: true };

  // 3) Bosqichlar (jami) — vertikal funnel
  const s3 = wb.addWorksheet(t('Bosqichlar'));
  s3.columns = [{ header: t('Bosqich'), key: 'step', width: 32 }, { header: t('Soni'), key: 'val', width: 14 }];
  s3.addRow({ step: `1. ${t('Talabnoma')}`, val: tt.talabnoma });
  s3.addRow({ step: `2. ${t('Sanoat palatasi')}`, val: tt.sanoat });
  s3.addRow({ step: `3. ${t('Sudga chiqarilgan (jami)')}`, val: tt.sud.total });
  s3.addRow({ step: `   — ${t('koʻrib chiqishda')}`, val: tt.sud.inReview });
  s3.addRow({ step: `   — ${t('qanoatlantirilgan')}`, val: tt.sud.granted });
  s3.addRow({ step: `   — ${t('qaytarilgan')}`, val: tt.sud.returned });
  s3.addRow({ step: `   — ${t('rad qilingan')}`, val: tt.sud.rejected });
  s3.addRow({ step: `4. ${t('MIBga chiqarilgan')}`, val: tt.mib });
  bold1(s3);

  // 4) Umumiy xulosa
  const s4 = wb.addWorksheet(t('Umumiy'));
  s4.columns = [{ header: t('Koʻrsatkich'), key: 'k', width: 34 }, { header: t('Qiymat'), key: 'v', width: 20 }];
  s4.addRow({ k: t('Snapshot (sana)'), v: snapLabel });
  s4.addRow({ k: t('Firmalar soni'), v: d.firms.length });
  s4.addRow({ k: t('Mijozlar (kishi) soni'), v: tt.clients });
  s4.addRow({ k: t('Jami ishlar'), v: tt.total });
  s4.addRow({ k: t('Talabnoma yuborilgan'), v: tt.talabnoma });
  s4.addRow({ k: t('Sanoat palatasida'), v: tt.sanoat });
  s4.addRow({ k: t('Sudga chiqarilgan'), v: tt.sud.total });
  s4.addRow({ k: t('MIBga chiqarilgan'), v: tt.mib });
  s4.addRow({ k: t('Jami qarz (soʻm)'), v: tt.debt });
  bold1(s4); s4.getColumn('v').numFmt = '#,##0';

  // 5) Viloyat kesimi — oqim tartibida: Talabnoma → Sud → MIBga
  const s5 = wb.addWorksheet(t('Viloyatlar'));
  s5.columns = [
    { header: t('Viloyat'), key: 'reg', width: 22 },
    { header: t('Mijozlar'), key: 'cli', width: 11 },
    { header: t('Talabnoma'), key: 'tal', width: 12 },
    { header: t('Sudga (jami)'), key: 'sud', width: 14 },
    { header: t('Qanoatlantirilgan'), key: 'gr', width: 18 },
    { header: t('Qaytarilgan'), key: 'ret', width: 14 },
    { header: t('MIBga'), key: 'mib', width: 12 },
    { header: t('Jami qarz'), key: 'debt', width: 18 },
  ];
  for (const r of d.regions) s5.addRow({ reg: r.region, cli: r.clients, tal: r.talabnoma, sud: r.sudTotal, gr: r.granted, ret: r.returned, mib: r.mib, debt: r.debt });
  const rt = d.regions.reduce((a, r) => ({ cli: a.cli + r.clients, tal: a.tal + r.talabnoma, sud: a.sud + r.sudTotal, gr: a.gr + r.granted, ret: a.ret + r.returned, mib: a.mib + r.mib, debt: a.debt + r.debt }), { cli: 0, tal: 0, sud: 0, gr: 0, ret: 0, mib: 0, debt: 0 });
  s5.addRow({ reg: t('JAMI'), cli: rt.cli, tal: rt.tal, sud: rt.sud, gr: rt.gr, ret: rt.ret, mib: rt.mib, debt: rt.debt });
  bold1(s5); s5.lastRow!.font = { bold: true }; money(s5, 'debt');

  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b as ArrayBuffer));
}

export async function GET(req: NextRequest) {
  await requireAdmin();
  const t = getT();
  const snaps = await konveyerSnapshots().catch(() => []);
  const q = req.nextUrl.searchParams.get('s') ?? cookies().get('konv_s')?.value ?? null;
  const parsed = q ? Number(q) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const snapLabel = snaps.find((s) => s.id === selectedId)?.label ?? '—';

  const data = await bossReport(selectedId);
  const buf = await buildBossExcel(data, snapLabel, t);
  const name = `${t('Boshliq hisoboti')}_${snapLabel.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
