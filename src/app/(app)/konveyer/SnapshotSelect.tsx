'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Dropdown } from './Dropdown';

export interface SnapOpt {
  id: number;
  label: string;
  cases: number;
}

/** Snapshot picker — custom pro dropdown, navigates to ?s=<id>. */
export function SnapshotSelect({ options, value }: { options: SnapOpt[]; value: number }) {
  const router = useRouter();
  if (options.length === 0) return null;

  const opts = options.map((o) => ({ value: String(o.id), label: o.label, hint: `${o.cases.toLocaleString('ru-RU')} ta` }));

  return (
    <Dropdown
      value={String(value)}
      options={opts}
      onChange={(v) => router.push(`/konveyer?s=${v}`)}
      className="min-w-[210px]"
    />
  );
}
