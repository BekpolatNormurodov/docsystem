// xat.hippo mail lifecycle statuses (Uzbek labels), extracted verbatim from
// the frontend (Sent chunk performType switch + i18n). Used to summarize how a
// sent registry's letters progressed: Jo'natildi -> Yetkazilgan / various
// failure reasons -> Kvitansiya.
import { listRegistryMails } from './xat';
import type { HippoSession } from './login';

// activePerform.performType -> Uzbek label + coarse bucket.
export const PERFORM_TYPE: Record<string, { label: string; bucket: 'delivered' | 'failed' | 'pending' }> = {
  Delivered: { label: 'Yetkazilgan', bucket: 'delivered' },
  SuccessDelivered: { label: 'Yetkazilgan', bucket: 'delivered' },
  ReceiverDead: { label: 'Oluvchi vafot etgan', bucket: 'failed' },
  ReceiverNotLivesThere: { label: 'Bu manzilda yashamaydi', bucket: 'failed' },
  IncompleteAddress: { label: "To'liq manzil ko'rsatilmagan", bucket: 'failed' },
  InvalidAddress: { label: "Noto'g'ri manzil", bucket: 'failed' },
  ReceiverRefused: { label: 'Qabul qilishdan bosh tortdi', bucket: 'failed' },
  ReceiverRefuse: { label: 'Qabul qilishdan bosh tortdi', bucket: 'failed' },
  ReceiverNotAtHome: { label: "Uyda yo'q", bucket: 'failed' },
  NotAtHome: { label: "Uyda yo'q", bucket: 'failed' },
  ReceiverDidntAppearOnNotice: { label: 'Xabarnomaga kelmadi', bucket: 'failed' },
  OrganizationWithGivenAddressNotFound: { label: 'Manzildagi tashkilot topilmadi', bucket: 'failed' },
  TryPerform: { label: 'Urinilmoqda', bucket: 'pending' },
};

export function performLabel(performType?: string | null): { label: string; bucket: 'delivered' | 'failed' | 'pending' | 'none' } {
  if (!performType) return { label: "Ma'lumot yo'q", bucket: 'none' };
  return PERFORM_TYPE[performType] ?? { label: performType, bucket: 'pending' };
}

export interface RegistryMailSummary {
  registryId: string | number;
  total: number;
  sent: number;          // isSend === true
  draft: number;         // isSend === false
  delivered: number;     // performType Delivered/SuccessDelivered
  failed: number;        // any failure performType
  pendingPerform: number;// sent but no delivery outcome yet
  byPerform: Record<string, number>;   // label -> count
}

// Page through a registry's mails and tally the lifecycle statuses.
export async function summarizeRegistryMails(s: HippoSession, registryId: string | number, pageSize = 100): Promise<RegistryMailSummary> {
  const sum: RegistryMailSummary = { registryId, total: 0, sent: 0, draft: 0, delivered: 0, failed: 0, pendingPerform: 0, byPerform: {} };
  for (let page = 1; ; page++) {
    const { json } = await listRegistryMails(s, registryId, page, pageSize);
    const items: any[] = Array.isArray(json) ? json : json?.data?.items ?? json?.items ?? json?.data ?? [];
    if (!items.length) break;
    for (const m of items) {
      sum.total++;
      if (m.isSend) sum.sent++; else sum.draft++;
      const { label, bucket } = performLabel(m.activePerform?.performType);
      sum.byPerform[label] = (sum.byPerform[label] ?? 0) + 1;
      if (bucket === 'delivered') sum.delivered++;
      else if (bucket === 'failed') sum.failed++;
      else if (m.isSend) sum.pendingPerform++;
    }
    if (items.length < pageSize) break;
  }
  return sum;
}
