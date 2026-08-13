import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { palataScanSummary } from '@/lib/palata-scan';

export const runtime = 'nodejs';

// GET → palatadan qaytgan skan arizalar xulosasi (firma boʻyicha soni + case holati).
export async function GET() {
  await requireUser();
  const summary = await palataScanSummary();
  return NextResponse.json(summary);
}
