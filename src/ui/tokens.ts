import { CertStatus } from '../core/enums';

/** Status → dot colour. Plain map, safe to import from server *and* client modules. */
export const STATUS_DOT: Record<string, string> = {
  [CertStatus.DRAFT]: 'bg-slate-400',
  [CertStatus.ADMIN_REVIEW]: 'bg-amber-500',
  [CertStatus.DIRECTOR_REVIEW]: 'bg-violet-500',
  [CertStatus.SIGNED]: 'bg-accent-500',
};
