import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { fillBuyruqTemplate } from '@/lib/sud-buyruq';

export const runtime = 'nodejs';
export const maxDuration = 120;

// «Sud buyrug'i» shablonini to'ldirish: foydalanuvchi yuklаган .xlsx (Javobgar ustuni bo'yicha ism)
// ni portfelga solishtirib to'ldiradi va qaytarib beradi. Original ustunlar/format saqlanadi;
// faqat Da'vo summasi (asosiy qarz), boji (4%), manzil, tug'ilgan, pasport, JSHSHIR to'ladi.
export async function POST(req: NextRequest) {
  await requireAccess('sud-buyruq');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Fayl (file) yuborilmagan' }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Fayl juda katta (max 20MB)' }, { status: 413 });
  const firmParam = form?.get('firm');
  const codes = firmParam ? String(firmParam).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const buf = Buffer.from(await file.arrayBuffer());

  const { buffer, total, filled, unmatched } = await fillBuyruqTemplate(buf, { branchCodes: codes });

  const origName = (form?.get('name') ? String(form.get('name')) : (file as any).name || 'Buyruq') as string;
  const base = origName.replace(/\.xlsx$/i, '');
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
