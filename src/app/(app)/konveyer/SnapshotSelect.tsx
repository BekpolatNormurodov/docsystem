'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Dropdown } from './Dropdown';

export interface SnapOpt {
  id: number;
  label: string;
  cases: number;
}

/** Snapshot picker — custom pro dropdown, navigates to ?s=<id>. */
export function SnapshotSelect({ options, value }: { options: SnapOpt[]; value: number }) {
  const router = useRouter();
  // Navigate on the CURRENT route (was hardcoded to /konveyer) so the same picker drives every
  // Boshqaruv step-page — each keeps its own path, only the ?s= snapshot param changes.
  const pathname = usePathname();
  if (options.length === 0) return null;

  const opts = options.map((o) => ({ value: String(o.id), label: o.label, hint: `${o.cases.toLocaleString('ru-RU')} ta` }));

  return (
    <Dropdown
      value={String(value)}
      options={opts}
      onChange={(v) => router.push(`${pathname}?s=${v}`)}
      className="min-w-[210px]"
    />
  );
}
