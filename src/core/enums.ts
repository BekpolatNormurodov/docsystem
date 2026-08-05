export const Role = { YURIST: 'YURIST', ADMIN: 'ADMIN', RAHBAR: 'RAHBAR' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const CertStatus = {
  DRAFT: 'DRAFT',
  ADMIN_REVIEW: 'ADMIN_REVIEW',
  DIRECTOR_REVIEW: 'DIRECTOR_REVIEW',
  SIGNED: 'SIGNED',
} as const;
export type CertStatus = (typeof CertStatus)[keyof typeof CertStatus];

export const WfAction = {
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  RETURN: 'RETURN',
  SIGN: 'SIGN',
  DELETE: 'DELETE',
  RESTORE: 'RESTORE',
} as const;
export type WfAction = (typeof WfAction)[keyof typeof WfAction];
