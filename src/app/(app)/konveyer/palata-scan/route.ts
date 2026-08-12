import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { palataScanSummary } from '@/lib/palata-scan';

export const runtime = 'nodejs';

// GET → palatadan qaytgan skan arizalar xulosasi (firma boʻyicha soni + case holati).
export async function GET() {
  await requireAdmin();
  const summary = await palataScanSummary();
  return NextResponse.json(summary);
}
