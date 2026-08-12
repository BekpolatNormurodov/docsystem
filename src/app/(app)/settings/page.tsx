import { PageHeader } from '@/ui';
import { SlaSettings } from './SlaSettings';
import { BojiSettings } from './BojiSettings';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Sozlamalar" subtitle="Konveyer va hujjatlar uchun standart qiymatlar" />
      <div className="space-y-4">
        <SlaSettings />
        <BojiSettings />
        <div className="card p-5">
          <div className="mb-1 text-sm font-semibold">Hujjat standartlari</div>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>Standart sud: <span className="font-medium text-fg">«Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga»</span></li>
            <li>Shartnoma turi: <span className="font-medium text-fg">«ONLAYN»</span></li>
            <li>Palata imzolovchisi</li>
          </ul>
          <div className="mt-2 text-xs text-muted">Bu qiymatlar keyingi bosqichda shu yerdan tahrirlanadi.</div>
        </div>
      </div>
    </div>
  );
}
