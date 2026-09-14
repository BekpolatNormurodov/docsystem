'use client';

import { useState } from 'react';
import { CourtArizaDocument } from '@/ui';
import type { LoanArizaProps } from '@/core/ariza';
import { useT } from '@/lib/i18n/client';

/**
 * Toggles a single loan's ariza preview. Props are computed server-side by `loanToAriza` (the
 * exact mapping the .docx export in Plan 4 will reuse) and handed down already serialized —
 * Dates and plain strings only, no QR.
 */
export function ArizaPreview({ props }: { props: LoanArizaProps }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn-ghost text-xs">
        {open ? t('Arizani yashirish') : t('Arizani koʻrish')}
      </button>
      {open && (
        <div className="cert-frame mt-3">
          <CourtArizaDocument {...props} />
        </div>
      )}
    </div>
  );
}
