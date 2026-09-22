import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { fillBuyruqTemplate, fillBuyruqPerFirmZip } from '@/lib/sud-buyruq';

export const runtime = 'nodejs';
export const maxDuration = 120;

// «Sud buyrug'i» shablonini to'ldirish. Ikki natija:
//   • Firma tanlangan  → BITTA .xlsx (o'sha firma portfelidan qidiriladi).
//   • Firma tanlanmagan («Hammasi») → HAR firma uchun alohida .xlsx + ZIP.
// Original ustunlar/format saqlanadi; foydalanuvchi qiymatlariga tegilmaydi.
export async function POST(req: NextRequest) {
  await requireAccess('sud-buyruq');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Fayl (file) yuborilmagan' }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Fayl juda katta (max 20MB)' }, { status: 413 });
  const firmParam = form?.get('firm');
  const codes = firmParam ? String(firmParam).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const buf = Buffer.from(await file.arrayBuffer());
  const origName = (form?.get('name') ? String(form.get('name')) : (file as any).name || 'Buyruq') as string;
  const base = origName.replace(/\.xlsx$/i, '');

  // Firma tanlanmagan → per-firma ZIP.
  if (!codes || codes.length === 0) {
    const { buffer, perFirm } = await fillBuyruqPerFirmZip(buf);
    const total = perFirm.reduce((s, x) => s + x.total, 0);
    const filled = perFirm.reduce((s, x) => s + x.filled, 0);
    const unmatched = perFirm.reduce((s, x) => s + x.unmatched, 0);
    const outName = `${base} — firmalar bo'yicha.zip`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(outName)}"`,
        'X-Buyruq-Total': String(total),
        'X-Buyruq-Filled': String(filled),
        'X-Buyruq-Unmatched': String(unmatched),
        'X-Buyruq-Firms': String(perFirm.length),
        'X-Buyruq-PerFirm': encodeURIComponent(JSON.stringify(perFirm.map((f) => ({ n: f.shortName, t: f.total, f: f.filled, u: f.unmatched })))),
      },
    });
  }

  // Bitta firma → yagona .xlsx.
  const { buffer, total, filled, unmatched } = await fillBuyruqTemplate(buf, { branchCodes: codes });
  const outName = `${base} — to'ldirilgan.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(outName)}"`,
      'X-Buyruq-Total': String(total),
      'X-Buyruq-Filled': String(filled),
      'X-Buyruq-Unmatched': String(unmatched),
    },
  });
}
