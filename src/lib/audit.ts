import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { currentUser } from '@/lib/auth';

// Canonical action names. Kept as a const map so call sites don't drift on
// spelling and the Jurnal page can label them.
export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  STAGE_ADVANCE: 'STAGE_ADVANCE',
  TALABNOMA_SEND: 'TALABNOMA_SEND',
  TALABNOMA_GEN: 'TALABNOMA_GEN',
  ARIZA_GEN: 'ARIZA_GEN',
  PALATA_SCAN: 'PALATA_SCAN',
  INVOICE_GEN: 'INVOICE_GEN',
  INVOICE_BATCH: 'INVOICE_BATCH',
  FARMOYISH: 'FARMOYISH',
  PACKET_GEN: 'PACKET_GEN',
  COURT_SUBMIT: 'COURT_SUBMIT',
  MIB: 'MIB',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  SYNC: 'SYNC',
  SNAPSHOT_DELETE: 'SNAPSHOT_DELETE',
  FIRM_EDIT: 'FIRM_EDIT',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  CONNECT: 'CONNECT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

interface Actor {
  id?: number | null;
  username: string;
  role?: string | null;
}

interface AuditOpts {
  target?: string;
  detail?: unknown;
  /** Override the actor when the session cookie isn't readable yet (e.g. LOGIN). */
  actor?: Actor;
}

/**
 * Write one audit row. Best-effort: a logging failure must never break the real
 * mutation, so everything here is wrapped and swallowed. Resolves the actor from
 * the session unless one is passed explicitly.
 */
export async function audit(action: AuditAction | string, opts: AuditOpts = {}): Promise<void> {
  try {
    let actor = opts.actor;
    if (!actor) {
      const u = await currentUser();
      actor = u ? { id: u.id, username: u.username, role: u.role } : { username: 'anonymous' };
    }
    let ip: string | undefined;
    try {
      const h = headers();
      ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined;
    } catch {
      /* headers() unavailable outside a request scope — fine */
    }
    await prisma.auditLog.create({
      data: {
        userId: actor.id ?? null,
        username: actor.username,
        role: actor.role ?? null,
        action,
        target: opts.target ?? null,
        detail: opts.detail === undefined ? undefined : (opts.detail as any),
        ip: ip ?? null,
      },
    });
  } catch (e) {
    if (process.env.DEBUG) console.error('[audit] write failed:', e);
  }
}
