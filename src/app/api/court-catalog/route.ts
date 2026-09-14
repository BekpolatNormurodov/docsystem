import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

// billing.sud.uz'ning rasmiy sud katalogi (invoice formasidagi kaskad shu manbadan). Serverdan
// so'raymiz (CORSsiz) va FAQAT fuqarolik (CITIZEN) sudlarni qaytaramiz — boji invoice shu turga
// ketadi. Har sud: billing «id» (payload courtId), nomi, hududi. UI'da tanlab, «Sud id» o'zi to'ladi.
const SOURCE = 'https://billing.sud.uz/api/client/findCourts';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 soat kesh — sudlar deyarli o'zgarmaydi

interface CourtCatalogItem { id: number; name: string; ruName: string | null; type: string; regionId: number | null; address: string | null }
let cache: { at: number; items: CourtCatalogItem[] } | null = null;

export async function GET() {
  await requireAdmin();

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ items: cache.items, cached: true });
  }
  try {
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`billing.sud.uz ${res.status}`);
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    const items: CourtCatalogItem[] = raw
      .filter((c) => String(c.type) === 'CITIZEN' && c.isDeleted !== true)
      .map((c) => ({
        id: Number(c.id),
        name: String(c.name ?? ''),
        ruName: c.ruName != null ? String(c.ruName) : null,
        type: String(c.type),
        regionId: c.regionId != null ? Number(c.regionId) : null,
        address: c.address != null ? String(c.address) : null,
      }))
      .filter((c) => Number.isInteger(c.id) && c.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    cache = { at: Date.now(), items };
    return NextResponse.json({ items, cached: false });
  } catch (e) {
    // Kesh bo'lsa — eskisini beramiz (billing.sud.uz vaqtincha yiqilса ham ishlaydi).
    if (cache) return NextResponse.json({ items: cache.items, cached: true, stale: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Katalog olinmadi', items: [] }, { status: 502 });
  }
}
