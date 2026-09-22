import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { buildBuyruqExcel } from '@/lib/sud-buyruq';

export const runtime = 'nodejs';
export const maxDuration = 120;

// «Sud buyrug'i» Excel yuklab olish. Query: firm (bir yoki bir nechta branchCode), status (bir yoki
// bir nechta ADOLAT holati). Ikkalasini ham vergul bilan yoki takroriy param (firm=a&firm=b) beriladi.
export async function GET(req: NextRequest) {
  await requireAccess('sud-buyruq');
  const sp = req.nextUrl.searchParams;
  const multi = (key: string) => {
    const all = sp.getAll(key).flatMap((v) => v.split(','));
    return [...new Set(all.map((s) => s.trim()).filter(Boolean))];
  };
  const firms = multi('firm');
  const statuses = multi('status');
  if (!firms.length || !statuses.length) {
    return NextResponse.json({ error: 'firm va status tanlanishi shart' }, { status: 400 });
  }

  const { buffer } = await buildBuyruqExcel({ branchCodes: firms, statuses });
  const name = `Sud buyruq (${new Date().toISOString().slice(0, 10)}).xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
