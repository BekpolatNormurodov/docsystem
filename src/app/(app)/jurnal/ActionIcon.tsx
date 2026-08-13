'use client';

import { Ico } from '@/ui/icons';

// Per-action glyph. Client component: the Ico registry can only be indexed inside
// a client boundary (icons.tsx is 'use client' — see its RSC note). Color is
// inherited via currentColor from the parent badge.
const ACTION_ICON: Record<string, keyof typeof Ico> = {
  LOGIN: 'logout',
  LOGOUT: 'logout',
  STAGE_ADVANCE: 'redo',
  MIB: 'check',
  COURT_SUBMIT: 'building',
  TALABNOMA_SEND: 'files',
  TALABNOMA_GEN: 'files',
  ARIZA_GEN: 'pen',
  INVOICE_GEN: 'filePlus',
  INVOICE_BATCH: 'filePlus',
  FARMOYISH: 'files',
  PACKET_GEN: 'archive',
  PALATA_SCAN: 'print',
  IMPORT: 'add',
  EXPORT: 'files',
  SYNC: 'redo',
  SNAPSHOT_DELETE: 'close',
  FIRM_EDIT: 'building',
  USER_CREATE: 'add',
  USER_UPDATE: 'pen',
  USER_DELETE: 'close',
  PASSWORD_CHANGE: 'lock',
  CONNECT: 'link',
};

export function ActionIcon({ action, size = 16 }: { action: string; size?: number }) {
  const Glyph = Ico[ACTION_ICON[action] ?? 'info'];
  return <Glyph size={size} />;
}
