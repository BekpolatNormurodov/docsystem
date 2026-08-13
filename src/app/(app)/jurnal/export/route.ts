import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { actionLabel } from '@/lib/audit-labels';

export const runtime = 'nodejs';

const EXPORT_CAP = 5000; // bound the sync export

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function detailText(detail: unknown): string {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  try {
    const o = detail as Record<string, unknown>;
    return Object.entries(o)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' · ');
  } catch {
    return '';
  }
}

// GET /jurnal/export?action=&q=&from=&to= — the filtered log as an .xlsx.
// A yurist can only export their OWN rows (username forced), same as the page.
export async function GET(req: NextRequest) {
  const me = await requireUser();
  const isAdmin = me.role === 'ADMIN';
  const sp = req.nextUrl.searchParams;
  const action = sp.get('action') && sp.get('action') !== 'all' ? String(sp.get('action')) : '';
  const q = isAdmin ? (sp.get('q')?.trim() ?? '') : '';
  const from = sp.get('from');
  const to = sp.get('to');

  const where: {
    action?: string;
    username?: string | { contains: string };
    createdAt?: { gte?: Date; lte?: Date };
  } = {};
  if (action) where.action = action;
  if (!isAdmin) where.username = me.username;
  else if (q) where.username = { contains: q };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: EXPORT_CAP,
    select: { username: true, role: true, action: true, target: true, detail: true, ip: true, createdAt: true },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Jurnal');
  ws.columns = [
    { header: 'Vaqt', key: 't', width: 20 },
    { header: 'Foydalanuvchi', key: 'u', width: 20 },
    { header: 'Rol', key: 'r', width: 10 },
    { header: 'Amal', key: 'a', width: 24 },
    { header: 'Obyekt', key: 'o', width: 18 },
    { header: 'Tafsilot', key: 'd', width: 50 },
    { header: 'IP', key: 'ip', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      t: fmt(r.createdAt),
      u: r.username,
      r: r.role === 'ADMIN' ? 'admin' : r.role === 'YURIST' ? 'yurist' : (r.role ?? ''),
      a: actionLabel(r.action),
      o: r.target ?? '',
      d: detailText(r.detail),
      ip: r.ip ?? '',
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const stamp = `${pad(new Date().getDate())}-${pad(new Date().getMonth() + 1)}`;
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Jurnal_${stamp}.xlsx"`,
    },
  });
}
