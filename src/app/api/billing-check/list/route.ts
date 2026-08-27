import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { searchMyChecks } from '@/lib/billing-check/search';
import { upsertCheckedInvoice } from '@/lib/billing-check/store';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST { inn?, passportNumber?, page?, size? } — billing.sud.uz «my-checks» sahifasini
// takrorlaydi: STIR (yuridik) yoki pasport (jismoniy) bo'yicha kvitansiyalar ro'yxati,
// sahifalab. Har chaqiruv o'z (bir martalik) captcha tokenini oladi. Har bir qatordagi
// kvitansiya keshga upsert qilinadi.
export async function POST(req: NextRequest) {
  const user = await requireAccess('invoice-check');
  const body = await req.json().catch(() => ({}));
  const inn = body?.inn ? String(body.inn).trim() : undefined;
  const passportNumber = body?.passportNumber ? String(body.passportNumber).trim() : undefined;
  const page = Number.isFinite(body?.page) ? Number(body.page) : 0;
  const size = Number.isFinite(body?.size) ? Number(body.size) : 10;
  const query = inn || passportNumber || '';
  // Ommaviy yig'ishda bu route o'nlab marta chaqiriladi — har sahifa uchun tarix yozuvi
  // yaratilsa jurnal ko'milib ketardi. Mijoz oxirida BITTA umumiy yozuv qo'shadi (POST /history).
  const silent = body?.silent === true;

  if (!inn && !passportNumber) return NextResponse.json({ error: 'STIR yoki pasport kerak' }, { status: 400 });

  try {
    const result = await searchMyChecks({ inn, passportNumber, page, size });
    for (const row of result.content) {
      await upsertCheckedInvoice({
        number: row.number,
        invoiceStatus: row.invoiceStatus,
        amount: row.amount,
        paidAmount: row.paidAmount,
        mustPayAmount: row.mustPayAmount,
        balance: row.balance,
        payer: row.payer,
        payerTin: row.payerTin,
        court: row.court,
        courtId: row.courtId,
        forAccount: row.forAccount,
        description: row.description,
        payCategory: row.payCategory,
        claimCaseNumber: row.claimCaseNumber,
        issuedAt: row.issued ? new Date(row.issued) : null,
        expiresAt: row.overdue ? new Date(row.overdue) : null,
        source: 'LIST',
        raw: row.raw,
      });
    }
    if (!silent) {
      await prisma.billingCheckQuery.create({
        data: { createdBy: user.username, mode: 'LIST', query, page: result.pageNumber, resultCount: result.content.length, status: 'OK' },
      });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    const message = e?.message || 'Qidirishda xato';
    await prisma.billingCheckQuery.create({
      data: { createdBy: user.username, mode: 'LIST', query, page, resultCount: 0, status: 'FAILED', message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
