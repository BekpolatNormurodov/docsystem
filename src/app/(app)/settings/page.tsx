import { PageHeader } from '@/ui';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Sozlamalar" subtitle="Bu boʻlim keyingi bosqichlarda toʻldiriladi" />
      <div className="card p-6">
        <p className="text-sm text-muted">
          Kelgusida shu yerda tahrirlanadigan standart qiymatlar:
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
          <li>
            Standart sud: <span className="font-medium text-fg">«Fuqarolik ishlari boʻyicha Uchtepa tumanlararo sudiga»</span>
          </li>
          <li>
            Shartnoma turi: <span className="font-medium text-fg">«ONLAYN»</span>
          </li>
          <li>
            Palata imzolovchisi
          </li>
        </ul>
      </div>
    </div>
  );
}
