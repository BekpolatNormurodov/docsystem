import { NextRequest, NextResponse } from 'next/server';
import { requireStep } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Eimzo, parseAlias } from '@/lib/hippo/eimzo';
import { eimzoMode } from '@/lib/eimzo-mode';

export const runtime = 'nodejs';
export const maxDuration = 90; // list_certificates parses every PFX and can take ~40-55s with several keys

// The picker is served in TWO steps (like the hippo status panel): without ?refresh the DB-cached
// snapshot of the last successful E-IMZO scan is returned INSTANTLY (no CAPIWS wait, never freezes);
// with ?refresh=1 the client re-scans E-IMZO live (slow) and re-writes the cache. Keys are
// machine-wide (the operator's inserted tokens), so one global cache key is enough.
const CACHE_KEY = 'eimzo.keys.v1';

interface KeyOut {
  disk: string; path: string; name: string; alias: string;
  cn: string | null; org: string | null; tin: string | null;
  validFrom: string | null; validTo: string | null;
}

// Live enumeration WITH per-disk diagnostics, so an empty result tells us WHY (which disks
// E-IMZO reported and what each one returned/errored) instead of a blank "DSKEYS boʻsh".
async function scanKeysDiag(): Promise<{ keys: KeyOut[]; diag: { disks: unknown; perDisk: { disk: string; count: number; error?: string }[] } }> {
  const disksRes = (await Eimzo.listDisks()) as { disks?: unknown };
  const disks: string[] = Array.isArray(disksRes?.disks) ? (disksRes.disks as string[]) : [];
  const perDisk: { disk: string; count: number; error?: string }[] = [];
  const keys: KeyOut[] = [];
  for (const disk of disks) {
    try {
      const cr = (await Eimzo.listCertificates(disk)) as { certificates?: Array<{ disk: string; path: string; name: string; alias: string }> };
      const certs = cr?.certificates ?? [];
      for (const c of certs) {
        const info = parseAlias(c.alias);
        keys.push({
          disk: c.disk, path: c.path, name: c.name, alias: c.alias,
          cn: info.cn ?? null, org: info.org ?? null, tin: info.tin ?? null,
          validFrom: info.validFrom ?? null, validTo: info.validTo ?? null,
        });
      }
      perDisk.push({ disk, count: certs.length });
    } catch (e) {
      perDisk.push({ disk, count: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { keys, diag: { disks: disksRes?.disks ?? null, perDisk } };
}

// GET /konveyer/keys — signing-capable staff only (admins connect, sud-yurists court-sign).
export async function GET(req: NextRequest) {
  await requireStep('sud');

  // CLIENT MODE: the server has no local E-IMZO — the browser enumerates keys itself
  // (window.EimzoBrowser.listKeys). Return the flag instantly so the picker switches paths.
  if (eimzoMode() === 'client') {
    return NextResponse.json({ ok: true, clientMode: true, keys: [] });
  }

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';

  if (!refresh) {
    // Instant: the last scan we cached — no E-IMZO round-trip.
    const row = await prisma.setting.findUnique({ where: { key: CACHE_KEY } }).catch(() => null);
    if (row?.value) {
      try { return NextResponse.json({ ...JSON.parse(row.value), cached: true }); } catch { /* corrupt → fall through */ }
    }
    return NextResponse.json({ ok: true, keys: [], cached: true, empty: true });
  }

  // Live E-IMZO scan.
  try {
    const { keys, diag } = await scanKeysDiag();
    if (keys.length) {
      // Persist ONLY a non-empty scan — never overwrite a good cache with a transient empty result.
      const payload = { ok: true, keys, checkedAt: new Date().toISOString() };
      try {
        const value = JSON.stringify(payload);
        await prisma.setting.upsert({ where: { key: CACHE_KEY }, create: { key: CACHE_KEY, value }, update: { value } });
      } catch (e) { console.error('eimzo keys cache write failed', e); }
      return NextResponse.json({ ...payload, cached: false });
    }
    // Empty — surface the diagnostics (which disks E-IMZO reported, per-disk error/count).
    console.error('eimzo keys scan returned 0 keys', JSON.stringify(diag));
    return NextResponse.json({ ok: true, keys: [], cached: false, checkedAt: new Date().toISOString(), debug: diag });
  } catch (e) {
    // list_disks itself failed → E-IMZO not reachable / not running. Fall back to cache if any.
    const msg = e instanceof Error ? e.message : 'E-IMZO kalitlarini oʻqib boʻlmadi';
    const row = await prisma.setting.findUnique({ where: { key: CACHE_KEY } }).catch(() => null);
    if (row?.value) {
      try { return NextResponse.json({ ...JSON.parse(row.value), cached: true, staleError: msg }); } catch { /* fall through */ }
    }
    return NextResponse.json({ ok: false, error: msg, keys: [] }, { status: 502 });
  }
}
